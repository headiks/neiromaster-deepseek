// Логика админки. Извлечено из inline <script> admin.html без изменений —
// порядок исполнения тот же (внешний script с src выполняется на месте подключения).
// refreshIcons() определяется отдельным inline-скриптом после загрузки Lucide (см. admin.html).
        // ---------------- Общее ----------------
        function escapeHtml(str) {
            if (str === null || str === undefined) return '';
            const div = document.createElement('div');
            div.textContent = String(str);
            return div.innerHTML;
        }

        /** fetch с единой обработкой протухшей сессии: 401 -> обратно на форму входа. */
        function api(url, options) {
            return fetch(url, options).then(res => {
                if (res.status === 401) {
                    window.location.href = '/login';
                    throw new Error('Сессия истекла');
                }
                return res;
            });
        }

        function apiJson(url, options) {
            return api(url, options).then(res => res.json().then(data => ({ ok: res.ok, data })));
        }

        // ---- Контроллер состояний для динамического обновления UI по кнопкам ----
        // Единая точка: занятость кнопки (спиннер+блокировка), именованный опрос
        // (гарантирует один таймер на ключ) и запуск фоновой задачи с прогрессом.
        const NM = {
            _timers: {},
            busy(el, on, text) {
                if (typeof el === 'string') el = document.getElementById(el);
                if (!el) return;
                if (on) {
                    if (el.dataset.orig === undefined) el.dataset.orig = el.innerHTML;
                    el.disabled = true;
                    if (text) el.innerHTML = `<i data-lucide="loader"></i> ${text}`;
                } else {
                    el.disabled = false;
                    if (el.dataset.orig !== undefined) { el.innerHTML = el.dataset.orig; delete el.dataset.orig; }
                }
                refreshIcons();
            },
            startPoll(key, fn, interval) { this.stopPoll(key); this._timers[key] = setInterval(fn, interval); fn(); },
            stopPoll(key) { if (this._timers[key]) { clearInterval(this._timers[key]); delete this._timers[key]; } },
            // Опрос фоновой задачи через /documents/jobs/{id} до терминального статуса.
            runJob(key, jobId, { onProgress, onDone, interval = 1500 } = {}) {
                this.startPoll(key, () => {
                    api(`/documents/jobs/${encodeURIComponent(jobId)}`).then(r => r.ok ? r.json() : null).then(job => {
                        if (!job) return;
                        if (onProgress) onProgress(job);
                        if (['done', 'error', 'cancelled'].includes(job.status)) {
                            this.stopPoll(key);
                            if (onDone) onDone(job);
                        }
                    }).catch(() => {});
                }, interval);
            },
        };

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`pane-${tab.dataset.tab}`).classList.add('active');
                if (tab.dataset.tab === 'builder') ensureBuilderLoaded();
                if (tab.dataset.tab === 'plantexts') ensurePlanTextsLoaded();
                if (tab.dataset.tab === 'employees') ensureEmployeesLoaded();
                if (tab.dataset.tab === 'questions') loadQuestions();
                renderNextStep();
                if (tab.dataset.tab === 'docs') { loadCoverage(); if (document.getElementById('stage-details').open) loadStageBoard(); }
            });
        });

        let currentUser = null;
        let isOwner = false;

        api('/api/me').then(r => r.json()).then(me => {
            currentUser = me;
            isOwner = me.role === 'owner';
            const roleTitle = isOwner ? 'суперадмин' : 'администратор';
            document.getElementById('whoami').innerHTML = `<i data-lucide="user"></i> ${escapeHtml(me.full_name || me.username)} · ${roleTitle}`;
            if (employeesCache.length) renderEmployees(employeesCache);
            if (docsCache.length) renderDocuments(docsCache);   // группировка по владельцу — только суперадмину
            // «Переанализировать всё» задевает документы всех администраторов -> только суперадмину
        }).catch(() => {});

        function logout() {
            fetch('/api/logout', { method: 'POST' }).finally(() => { window.location.href = '/login'; });
        }

        function openPasswordDialog() {
            document.getElementById('password-error').style.display = 'none';
            document.getElementById('old-password').value = '';
            document.getElementById('new-password').value = '';
            document.getElementById('password-dialog').showModal();
        }

        function submitPasswordChange() {
            const errorBox = document.getElementById('password-error');
            apiJson('/api/password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    old_password: document.getElementById('old-password').value,
                    new_password: document.getElementById('new-password').value,
                }),
            }).then(({ ok, data }) => {
                if (!ok) {
                    errorBox.textContent = data.detail || 'Не удалось сменить пароль';
                    errorBox.style.display = 'block';
                    return;
                }
                alert('Пароль изменён. Войдите заново.');
                window.location.href = '/login';
            });
        }

        // ---------------- База знаний ----------------
        const dropzone = document.getElementById('dropzone');
        const fileInput = document.getElementById('file-input');
        const docList = document.getElementById('doc-list');
        const uploadProgress = document.getElementById('upload-progress');

        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) uploadFiles(fileInput.files);
        });
        ['dragenter', 'dragover'].forEach(evt => {
            dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
        });
        ['dragleave', 'drop'].forEach(evt => {
            dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); });
        });
        dropzone.addEventListener('drop', (e) => {
            if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
        });

        // Прогресс по каждому файлу: каноничное имя -> строка статуса. Файлы обрабатываются
        // фоновой очередью на сервере. Статус тянем из durable-реестра GET /documents
        // (переживает рестарт и работу в несколько uvicorn-воркеров), а не из джоб-стора
        // в памяти процесса.
        const uploadStatus = {};
        const pendingDocs = new Set();   // каноничные имена, ждущие завершения индексации

        function renderUploadStatus() {
            const rows = Object.entries(uploadStatus);
            uploadProgress.innerHTML = rows.length
                ? rows.map(([name, line]) => `<div>${escapeHtml(name)}: ${line}</div>`).join('')
                : '';
        }

        function uploadFiles(fileList) {
            Array.from(fileList).forEach(uploadFile);
            fileInput.value = '';
        }

        function uploadFile(file, mode) {
            const formData = new FormData();
            formData.append('file', file);
            uploadStatus[file.name] = 'загрузка...';
            renderUploadStatus();

            apiJson('/documents/upload' + (mode ? '?mode=' + mode : ''), { method: 'POST', body: formData })
                .then(({ ok, data }) => {
                    if (data && data.conflict === 'same_name') {
                        // Новая версия документа: одной кнопкой заменить старую или сохранить рядом.
                        const who = data.uploaded_by_name ? `, загрузил ${data.uploaded_by_name}` : '';
                        const replace = data.can_replace && confirm(
                            `Документ «${data.filename}» уже есть (${(data.uploaded_at || '').replace('T', ' ')}${who}).\n\n`
                            + 'ОК — заменить старую версию новой (старая удалится, сообщения по ней обновятся).\n'
                            + 'Отмена — выбрать другое действие.');
                        if (replace) { uploadFile(file, 'replace'); return; }
                        if (confirm(`Сохранить новый файл как отдельный документ (под именем «${data.filename.replace(/(\.[^.]+)$/, ' (2)$1')}» или похожим)?`)) {
                            uploadFile(file, 'separate'); return;
                        }
                        delete uploadStatus[file.name];
                        renderUploadStatus();
                        return;
                    }
                    if (data && data.duplicate) {
                        uploadStatus[file.name] = escapeHtml(data.message);
                        renderUploadStatus();
                        return;
                    }
                    if (!ok) {
                        uploadStatus[file.name] = `${escapeHtml(data.detail || 'ошибка загрузки')}`;
                        renderUploadStatus();
                        return;
                    }
                    // Каноничное имя из реестра (санитайзинг мог изменить исходное) —
                    // по нему сверяемся со списком /documents.
                    const canonical = data.filename || file.name;
                    delete uploadStatus[file.name];
                    uploadStatus[canonical] = 'в очереди на обработку...';
                    pendingDocs.add(canonical);
                    renderUploadStatus();
                    bumpDocPolling();
                })
                .catch(err => {
                    uploadStatus[file.name] = `${escapeHtml(err.message)}`;
                    renderUploadStatus();
                });
        }

        // Сверяем ожидающие файлы с durable-реестром /documents: обновляем строку
        // статуса, а по завершении (indexed/error) убираем её и обновляем счётчики папок.
        function reconcilePending(docs) {
            if (!pendingDocs.size) return;
            const byName = {};
            docs.forEach(d => { byName[d.filename] = d; });
            let settled = false;
            pendingDocs.forEach(name => {
                const doc = byName[name];
                if (!doc) return;   // ещё не появился в реестре
                if (doc.status === 'indexed' || doc.status === 'error') {
                    delete uploadStatus[name];   // готово/ошибка уже видно в списке документов ниже
                    pendingDocs.delete(name);
                    settled = true;
                } else if (doc.status === 'processing') {
                    uploadStatus[name] = 'разбор docling → классификация по блокам (docpipe)...';
                } else {
                    uploadStatus[name] = 'в очереди на обработку...';
                }
            });
            renderUploadStatus();
            if (settled) { loadFolders(); loadCoverage(); renderNextStep(); }
        }

        // Живая сводка над списком: какой документ сейчас обрабатывается и сколько в очереди.
        function renderProcSummary(docs) {
            const el = document.getElementById('doc-proc-summary');
            const overall = document.getElementById('doc-overall');
            if (!el) return;
            const active = docs.filter(d => d.status === 'processing' || d.status === 'reanalyzing');
            const queued = docs.filter(d => d.status === 'uploaded');
            if (!active.length && !queued.length) {
                el.style.display = 'none';
                if (overall) overall.style.display = 'none';
                return;
            }
            const parts = [];
            if (active.length) {
                const names = active.map(d => escapeHtml(d.filename)).join(', ');
                parts.push(`<span style="color:#78350f;">⏳ Обрабатывается: ${names}</span>`);
            }
            if (queued.length) parts.push(`<span style="color:#475569;">в очереди: ${queued.length}</span>`);
            el.innerHTML = parts.join(' · ');
            el.style.display = 'block';

            if (overall) {
                // Здесь бар осмыслен только для загрузок (uploaded→processing→indexed).
                const uploads = docs.filter(d => d.status === 'uploaded' || d.status === 'processing');
                if (!uploads.length) { overall.style.display = 'none'; return; }
                const total = uploads.length + docs.filter(d => d.status === 'indexed' || d.status === 'error').length;
                const doneUnits = docs.filter(d => d.status === 'indexed' || d.status === 'error').length
                    + docs.filter(d => d.status === 'processing').reduce((a, d) => a + (Number(d.progress) || 0) / 100, 0);
                const pct = Math.max(0, Math.min(100, Math.round(doneUnits / (total || 1) * 100)));
                document.getElementById('doc-overall-label').textContent =
                    `Обработка загрузок: в очереди/идёт ${uploads.length}`;
                document.getElementById('doc-overall-pct').textContent = pct + '%';
                document.getElementById('doc-overall-fill').style.width = pct + '%';
                overall.style.display = 'block';
            }
        }

        function statusLabel(status) {
            switch (status) {
                case 'uploaded': return 'Загружен';
                case 'processing': return 'Обрабатывается (docling)...';
                case 'indexed': return 'Готов к поиску';
                case 'reanalyzing': return 'Переанализ…';
                case 'error': return 'Ошибка';
                default: return status;
            }
        }

        function formatSize(bytes) {
            if (!bytes && bytes !== 0) return '';
            const kb = bytes / 1024;
            return kb < 1024 ? `${kb.toFixed(0)} КБ` : `${(kb / 1024).toFixed(1)} МБ`;
        }

        let anyReanalyzing = false;   // есть документы в статусе reanalyzing -> опрашиваем чаще
        let docsCache = [];
        function loadDocuments() {
            return api('/documents').then(r => r.json()).then(d => {
                const docs = d.documents || [];
                docsCache = docs;
                // быстрый опрос, пока есть любой активный статус (не только reanalyzing)
                anyReanalyzing = docs.some(doc =>
                    doc.status === 'reanalyzing' || doc.status === 'processing' || doc.status === 'uploaded');
                renderDocuments(docs);
                renderProcSummary(docs);
                reconcilePending(docs);
            }).catch(() => {});
        }

        // ---------------- Смысловые папки (управляет человек) ----------------
        let allFolders = [];

        function loadFolders() {
            return api('/folders').then(r => r.json())
                .then(d => { allFolders = d.folders || [];
                    if (document.getElementById('stage-details').open) loadStageBoard(); }).catch(() => {});
        }

        // Форматы соответствуют config.SUPPORTED_EXT. Ключ — расширение файла (оно же mime в реестре).
        const BEXT = { pdf:'pdf', docx:'docx', doc:'docx', pptx:'ppt', html:'web', htm:'web', md:'md', txt:'txt' };
        const BLABEL = { pdf:'PDF', docx:'DOCX', doc:'DOC', pptx:'PPTX', html:'HTML', htm:'HTM', md:'MD', txt:'TXT' };
        function bDocCard(d) {
            // Тип — из mime ИЛИ из расширения имени файла (в реестре mime может быть пустым,
            // тогда раньше показывалось «ФАЙЛ»). docFormat даёт и то, и другое.
            const fmt = docFormat(d);
            const sc = (d.score != null) ? `<div class="sc">уверенность ${Number(d.score).toFixed(2)}</div>` : '';
            return `<div class="bdoc" data-fn="${escapeHtml(d.filename || '')}" onclick="openSubstageMap(this.dataset.fn)" title="Показать куски текста и критерий попадания"><div class="ext ${fmt.cls}">${fmt.label}</div><div><div class="nm">${escapeHtml(d.filename || '')}</div>${sc}</div></div>`;
        }
        function bCountDocs(s) { let n = (s.documents || []).length; (s.substages || []).forEach(x => n += (x.documents || []).length); return n; }
        function renderStageBoard(b) {
            const el = document.getElementById('stage-board');
            if (!el) return;
            let html = '';
            (b.stages || []).forEach((s, i) => {
                let rows = '';
                (s.substages || []).forEach(sub => {
                    rows += `<div class="sub-r"><div><div class="sub-t">${escapeHtml(sub.title || '')}</div><div class="sub-c">${(sub.documents || []).length} док.</div></div>`
                          + `<div class="sub-docs">${(sub.documents || []).length ? sub.documents.map(bDocCard).join('') : '<div class="bempty">— нет документов —</div>'}</div></div>`;
                });
                if ((s.documents || []).length) {
                    rows += `<div class="sub-r"><div><div class="sub-t">В этапе (без подэтапа)</div></div><div class="sub-docs">${s.documents.map(bDocCard).join('')}</div></div>`;
                }
                html += `<section class="stg"><header class="stg-head"><div class="stg-n">${i + 1}</div>`
                      + `<div><div class="stg-tt">${escapeHtml(s.title || '')}</div><div class="stg-dd">${escapeHtml(s.description || '')}</div></div>`
                      + `<span class="stg-count">${bCountDocs(s)} док.</span></header>${rows || '<div class="sub-r"><div class="bempty">нет подэтапов</div></div>'}</section>`;
            });
            if ((b.unassigned || []).length) {
                html += `<section class="stg unassigned"><header class="stg-head"><div class="stg-n">?</div>`
                      + `<div><div class="stg-tt">Без уверенной привязки</div><div class="stg-dd">Загружены, но не отнесены к этапу — проверьте вручную</div></div>`
                      + `<span class="stg-count">${b.unassigned.length} док.</span></header>`
                      + `<div class="sub-r"><div><div class="sub-t">Требует решения</div></div><div class="sub-docs">${b.unassigned.map(bDocCard).join('')}</div></div></section>`;
            }
            el.innerHTML = html || '<div class="empty-hint">Пока нет ни этапов, ни документов.</div>';
            refreshIcons();
        }
        // ---------------- Тексты плана адаптации ----------------
        let _planTextsLoaded = false;
        function ensurePlanTextsLoaded() {
            if (_planTextsLoaded) return;
            api('/plans').then(r => r.json()).then(d => {
                const sel = document.getElementById('pt-plan');
                const plans = d.plans || [];
                sel.innerHTML = plans.length
                    ? plans.map(p => `<option value="${escapeHtml(p.plan_id)}">${escapeHtml(p.title)}${p.role ? ' · ' + escapeHtml(p.role) : ''}</option>`).join('')
                    : '<option value="">— планов нет —</option>';
                _planTextsLoaded = true;               // фиксируем только после успешной загрузки
                if (plans.length) loadPlanTexts();
            }).catch(() => {
                // транзиентный сбой — не запираем вкладку, дадим повторить при следующем открытии
                document.getElementById('pt-body').innerHTML =
                    '<div class="empty-hint">Не удалось загрузить список планов. Нажмите «Обновить».</div>';
            });
        }
        function refreshPlanTexts() { _planTextsLoaded = false; ensurePlanTextsLoaded(); }
        function loadPlanTexts() {
            const pid = document.getElementById('pt-plan').value;
            if (!pid) { document.getElementById('pt-body').innerHTML = '<div class="empty-hint">Выберите план.</div>'; return; }
            // Селектор должностей: объединяем ДОСТУПНЫЕ (из профилей сотрудников и штатки)
            // с УЖЕ сгенерированными — чтобы введённую вручную/загруженную должность можно
            // было выбрать и сгенерировать под неё. ✓ помечает те, где текст уже есть.
            api(`/plans/${encodeURIComponent(pid)}/professions`).then(r => r.ok ? r.json() : {})
                .then(d => {
                    const gen = new Set(d.generated_names
                        || (d.professions || []).map(p => (typeof p === 'string') ? p : (p.profession || p.slug || '')));
                    const names = Array.from(new Set([...(d.available || []), ...gen]))
                        .sort((a, b) => a.localeCompare(b, 'ru'));
                    document.getElementById('pt-prof').innerHTML =
                        '<option value="">Общие (для всех должностей)</option>' +
                        names.map(name => {
                            const mark = gen.has(name) ? '✓ ' : '';
                            return `<option value="${escapeHtml(name)}">${mark}${escapeHtml(name)}</option>`;
                        }).join('');
                }).finally(renderPlanTexts);
        }
        function renderPlanTexts() {
            const pid = document.getElementById('pt-plan').value;
            const prof = document.getElementById('pt-prof').value || '';
            const body = document.getElementById('pt-body');
            const meta = document.getElementById('pt-meta');
            if (!pid) return;
            body.innerHTML = '<div class="empty-hint">Загрузка…</div>';
            api(`/plans/${encodeURIComponent(pid)}/schedule${prof ? '?profession=' + encodeURIComponent(prof) : ''}`)
                .then(r => r.status === 404 ? null : r.json())
                .then(sch => {
                    if (!sch) { meta.textContent = ''; renderPlanSkeleton(pid, body); return; }
                    const msgs = sch.messages || [];
                    meta.textContent = `сообщений: ${msgs.length}${sch.generated_at ? ' · ' + sch.generated_at.replace('T', ' ') : ''}`;
                    // группировка по этапам -> подэтапам (порядок как в расписании)
                    const stages = [];
                    const byStage = {};
                    msgs.forEach(m => {
                        const sid = (m.stage || {}).id;
                        if (!byStage[sid]) { byStage[sid] = { title: (m.stage || {}).title, order: (m.stage || {}).order || 0, subs: [] }; stages.push(sid); }
                        byStage[sid].subs.push(m);
                    });
                    stages.sort((a, b) => byStage[a].order - byStage[b].order);
                    body.innerHTML = stages.map((sid, i) => {
                        const st = byStage[sid];
                        const subs = st.subs.map(m => {
                            const txt = ((m.content || {}).text || '').trim();
                            const kind = (m.substage || {}).kind || '';
                            const stLabels = { skipped: 'пропущено — нет документа', error: 'ошибка', edited: 'правка вручную', pending: 'в очереди' };
                            const st2 = m.status && m.status !== 'generated'
                                ? ` <span class="pt-status pt-status-${escapeHtml(m.status)}">${escapeHtml(stLabels[m.status] || m.status)}</span>` : '';
                            // Причина для пропущенных/ошибочных — почему нет текста и что делать.
                            const reason = (m.status === 'skipped' || m.status === 'error') && m.error
                                ? `<div class="pt-reason" style="color:#92400e;font-size:13px;margin-top:4px;">${escapeHtml(m.error)}</div>` : '';
                            const srcNames = [...new Set((m.sources || []).map(s => typeof s === 'string' ? s : (s.source || s.filename || s.title || '')).filter(Boolean))];
                            const src = srcNames.length ? `<div class="pt-src">Источники: ${srcNames.map(escapeHtml).join(', ')}</div>` : '';
                            const mid = m.message_id || '';
                            const actions = mid ? `<div class="pt-actions" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                                <button class="icon-btn" onclick="editPlanText('${escapeHtml(mid)}', this)"><i data-lucide="pencil"></i> Редактировать</button>
                                <button class="icon-btn pt-regen" onclick="regenPlanText('${escapeHtml(mid)}', this)"><i data-lucide="refresh-cw"></i> Перегенерировать</button>
                            </div>` : '';
                            return `<div class="pt-sub" data-mid="${escapeHtml(mid)}">
                                <div class="pt-sub-h"><b>${escapeHtml((m.substage || {}).title || '')}</b>${kind ? ` <span class="pt-kind">${escapeHtml(kind)}</span>` : ''}${st2}</div>
                                <div class="pt-text" data-raw="${encodeURIComponent(txt)}">${txt ? escapeHtml(txt) : '<span class="empty-hint">— текст пуст —</span>'}</div>
                                ${reason}
                                ${src}
                                ${actions}
                            </div>`;
                        }).join('');
                        return `<section class="pt-stage"><h3 class="pt-stage-h">${i + 1}. ${escapeHtml(st.title || '')}</h3>${subs}</section>`;
                    }).join('') || '<div class="empty-hint">В расписании нет сообщений.</div>';
                    refreshIcons();
                })
                .catch(() => { body.innerHTML = '<div class="empty-hint">Не удалось загрузить тексты.</div>'; });
        }

        // Сообщений ещё нет: показываем структуру ВЫБРАННОГО плана (свой или стандартный) —
        // какие этапы/подэтапы будут, и что делать дальше.
        function renderPlanSkeleton(pid, body) {
            api(`/plans/${encodeURIComponent(pid)}`).then(r => r.ok ? r.json() : null).then(d => {
                const stages = ((d || {}).plan || {}).stages || [];
                const note = `<div class="plan-note"><i data-lucide="info"></i> Сообщений по этому плану ещё нет.
                    Нажмите «Обновить сообщения плана» — ИИ напишет их по загруженным документам.</div>`;
                body.innerHTML = note + stages.map((st, i) => `<section class="pt-stage"><h3 class="pt-stage-h">${i + 1}. ${escapeHtml(st.title)}</h3>`
                    + (st.substages || []).map(sub => `<div class="pt-sub"><div class="pt-sub-h"><b>${escapeHtml(sub.title)}</b>
                        <span class="pt-status pt-status-pending">ещё не сгенерировано</span></div>
                        ${sub.brief ? `<div class="pt-src">О чём: ${escapeHtml(sub.brief.slice(0, 220))}</div>` : ''}</div>`).join('')
                    + '</section>').join('');
                refreshIcons();
            }).catch(() => { body.innerHTML = '<div class="empty-hint">Сообщений ещё нет.</div>'; });
        }

        function regenPlanText(messageId, btn) {
            const pid = document.getElementById('pt-plan').value;
            const prof = document.getElementById('pt-prof').value || '';
            if (!pid || !messageId) return;
            if (!confirm('Переписать это сообщение заново? Текущий текст (в том числе ручные правки) будет заменён.')) return;
            if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Генерация…'; refreshIcons(); }
            const q = prof ? '?profession=' + encodeURIComponent(prof) : '';
            api(`/plans/${encodeURIComponent(pid)}/messages/${encodeURIComponent(messageId)}/regenerate${q}`, { method: 'POST' })
                .then(r => r.ok ? r.json() : Promise.reject(new Error('regenerate')))
                .then(() => renderPlanTexts())
                .catch(() => { if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="triangle-alert"></i> Ошибка, повторить'; refreshIcons(); } });
        }

        // Сводка для пользователя: сколько документов и хватает ли их планам адаптации.
        let coverageCache = [];
        function loadCoverage() {
            const box = document.getElementById('doc-summary');
            api('/plans/coverage').then(r => r.ok ? r.json() : { plans: [] }).then(d => {
                coverageCache = d.plans || [];
                const ready = docsCache.filter(x => x.status === 'indexed').length;
                const head = `<div class="doc-summary-head"><b>Загружено в систему: ${docsCache.length} ${plural(docsCache.length, 'документ', 'документа', 'документов')}</b>`
                    + (ready !== docsCache.length ? ` · готовы к работе: ${ready}` : '') + '</div>';
                if (!coverageCache.length) {
                    box.innerHTML = head + '<div class="stage-hint">Планов адаптации пока нет — создайте план на вкладке «Планы», и здесь появится, хватает ли ему документов.</div>';
                    return;
                }
                box.innerHTML = head + coverageCache.map(p => {
                    const pct = p.total ? Math.round(100 * p.covered / p.total) : 0;
                    const gaps = (p.missing || []).map(m =>
                        `<li><b>${escapeHtml(m.stage)}:</b> ${m.substages.map(escapeHtml).join(', ')}</li>`).join('');
                    return `<div class="cov-plan">
                        <div class="cov-head"><span>${escapeHtml(p.title || '')}</span>
                            <span class="cov-num ${pct === 100 ? 'ok' : ''}">${p.covered} из ${p.total} подэтапов обеспечены документами</span></div>
                        <div class="pbar"><div class="pbar-fill" style="width:${pct}%"></div></div>
                        ${gaps ? `<details class="cov-gaps"><summary>Нет материалов для ${p.total - p.covered} ${plural(p.total - p.covered, 'подэтапа', 'подэтапов', 'подэтапов')} — догрузите документы по этим темам</summary><ul>${gaps}</ul></details>`
                               : '<div class="cov-ok">Документов достаточно для всего плана.</div>'}
                    </div>`;
                }).join('');
                refreshIcons();
            }).catch(() => { box.innerHTML = '<div class="empty-hint">Не удалось посчитать покрытие.</div>'; });
        }
        function plural(n, one, few, many) {
            const m10 = n % 10, m100 = n % 100;
            if (m10 === 1 && m100 !== 11) return one;
            if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
            return many;
        }

        function loadStageBoard() {
            const el = document.getElementById('stage-board');
            if (!el) return;
            api('/documents/board').then(r => r.ok ? r.json() : null).then(b => {
                if (!b) { el.innerHTML = '<div class="empty-hint">Нет данных.</div>'; return; }
                renderStageBoard(b);
            }).catch(() => { el.innerHTML = '<div class="empty-hint">Не удалось загрузить структуру.</div>'; });
        }

        function smapClass(s) { return s >= 0.6 ? 'hi' : (s >= 0.5 ? 'mid' : 'lo'); }
        function openSubstageMap(filename) {
            if (!filename) return;
            const dlg = document.getElementById('substage-map-dialog');
            document.getElementById('substage-map-title').textContent = 'Куски документа: ' + filename;
            const body = document.getElementById('substage-map-body');
            body.innerHTML = '<div class="empty-hint">Загрузка…</div>';
            dlg.showModal();
            // Разметка документа по подэтапам — только LLM (docpipe): подэтапы с уверенностью,
            // обоснованием и пометкой «общая информация». Косинусной оценки больше нет.
            api(`/documents/${encodeURIComponent(filename)}/labels`)
                .then(r => r.status === 404 ? null : (r.ok ? r.json() : Promise.reject(new Error('labels'))))
                .then(d => {
                    if (d) { renderDocpipeMap(body, d, filename); return; }
                    body.innerHTML = '<div class="empty-hint">Документ ещё не размечен LLM — разметка идёт в фоне после загрузки. Обновите через минуту.</div>';
                })
                .catch(() => { body.innerHTML = '<div class="empty-hint">Ошибка загрузки.</div>'; });
        }

        function renderDocpipeMap(body, d, filename) {
            const secs = d.sections || [];
            const note = `<div class="plan-note" style="margin-bottom:10px;"><i data-lucide="scan-text"></i>
                Точная разметка (LLM, temp=0). Подробнее — с векторами и чанками — на странице
                <a href="/doc-breakdown">Разбор документа</a>.</div>`;
            if (!secs.length) { body.innerHTML = note + '<div class="empty-hint">Документ размечен, но блоков нет.</div>'; refreshIcons(); return; }
            body.innerHTML = note + secs.map((s, i) => {
                const head = `Кусок ${i + 1}${(s.heading_path && s.heading_path.length) ? ' · ' + escapeHtml(s.heading_path.join(' / ')) : ''}${s.page != null ? ' · стр. ' + s.page : ''}`;
                if (s.is_meaningful === false) {
                    return `<div class="smap-chunk smap-junk"><div class="smap-sec">${head} · служебный текст (в подэтапы не идёт)</div>`
                         + `<div class="txt">${escapeHtml((s.text || '').slice(0, 400))}</div></div>`;
                }
                let chips;
                if (s.is_general) {
                    chips = `<span class="smap-chip hi">общий для всех</span>`;
                } else {
                    chips = (s.substages || []).map(su =>
                        `<span class="smap-chip ${smapClass(su.confidence)}" title="${escapeHtml(su.description || '')}">`
                        + `${escapeHtml((s.stages[0] && s.stages[0].title) || '')} → ${escapeHtml(su.title || su.id)} `
                        + `<small>${su.confidence != null ? Math.round(su.confidence * 100) + '%' : ''}</small></span>`).join('');
                }
                const subs = chips ? `<div class="smap-subs">${chips}</div>` : '<div class="smap-none">— ни одному подэтапу не соответствует —</div>';
                const prof = s.is_general ? '' : ((s.professions || []).length ? `<div class="smap-sec">Профессии: ${escapeHtml(s.professions.join(', '))}</div>` : '');
                const why = s.why ? `<div class="smap-sec" style="color:#1e40af;">Почему: ${escapeHtml(s.why)}</div>` : '';
                return `<div class="smap-chunk"><div class="smap-sec">${head}</div>`
                     + `<div class="txt">${escapeHtml((s.text || '').slice(0, 600))}</div>${subs}${prof}${why}</div>`;
            }).join('');
            refreshIcons();
        }

        // Суперадмин видит документы ВСЕХ администраторов и группирует их по владельцу
        // (как папки в хранилище: <суперадмин>/<администратор>/<файл>).
        // Обычный администратор получает с сервера только свои — группировки нет.
        function renderDocuments(docs) {
            if (!docs.length) {
                docList.innerHTML = `<div class="empty-hint">${isOwner
                    ? 'Пока никто из администраторов не загрузил документы.'
                    : 'Пока нет ваших документов — добавьте первый регламент выше.'}</div>`;
                return;
            }
            if (!isOwner) { docList.innerHTML = docs.map(docCard).join(''); refreshIcons(); return; }

            const groups = new Map();
            docs.forEach(d => {
                const key = d.uploaded_by_name || 'Без владельца (загружено до разделения прав)';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(d);
            });
            docList.innerHTML = [...groups.entries()].map(([owner, list]) => {
                const dep = (list.find(d => d.department) || {}).department || '';
                return `<div class="owner-group">
                    <div class="owner-head"><i data-lucide="folder-open"></i>
                        <b>${escapeHtml(owner)}</b>${dep ? ` · ${escapeHtml(dep)}` : ''}
                        <span class="owner-count">${list.length} док.</span></div>
                    ${list.map(docCard).join('')}
                </div>`;
            }).join('');
            refreshIcons();
        }

        // Прогресс-бар одного документа. Активные фазы (processing/reanalyzing) — реальный
        // % из реестра (backend пишет phase/progress по ходу docling→чанки→эмбеддинги).
        // uploaded — «в очереди» бегущей полосой; error — красная; indexed — без бара.
        function docProgress(doc) {
            const s = doc.status;
            if (s === 'indexed') return '';
            if (s === 'error') {
                return `<div class="doc-prog"><div class="pbar"><div class="pbar-fill error" style="width:100%"></div></div></div>`;
            }
            if (s === 'uploaded') {
                return `<div class="doc-prog"><div class="doc-prog-line"><span>В очереди на обработку</span></div>`
                     + `<div class="pbar"><div class="pbar-fill indet"></div></div></div>`;
            }
            if (s === 'processing' || s === 'reanalyzing') {
                const pct = Number(doc.progress);
                const phase = doc.phase || statusLabel(s);
                if (Number.isFinite(pct) && pct > 0) {
                    return `<div class="doc-prog"><div class="doc-prog-line"><span>${escapeHtml(phase)}</span><span>${pct}%</span></div>`
                         + `<div class="pbar"><div class="pbar-fill" style="width:${Math.min(100, pct)}%"></div></div></div>`;
                }
                return `<div class="doc-prog"><div class="doc-prog-line"><span>${escapeHtml(phase)}</span></div>`
                     + `<div class="pbar"><div class="pbar-fill indet"></div></div></div>`;
            }
            return '';
        }

        function docFormat(doc) {
            // Формат — из mime (реестр метаданных) или, если его нет, из расширения имени файла.
            const raw = (doc.mime || (doc.filename || '').split('.').pop() || '').toLowerCase();
            return { cls: BEXT[raw] || 'gen', label: BLABEL[raw] || (raw ? raw.toUpperCase().slice(0, 4) : 'ФАЙЛ') };
        }
        function docCard(doc) {
                const fmt = docFormat(doc);
                const meta = [
                    doc.size_bytes !== undefined ? formatSize(doc.size_bytes) : null,
                    doc.chunks ? `${doc.chunks} блоков` : null,
                    doc.uploaded_at ? doc.uploaded_at.replace('T', ' ') : null,
                ].filter(Boolean).join(' · ');
                const folderSlugs = doc.folders || [];
                const folderLine = folderSlugs.length
                    ? `<div class="chips">${folderSlugs.map(s => `<span class="folder-tag"><i data-lucide="folder"></i> ${escapeHtml(folderName(s))}</span>`).join('')}</div>`
                    : (doc.status === 'indexed' ? `<div class="doc-meta">Общая база «Все документы» (без папки)</div>` : '');
                const summaryLine = doc.summary
                    ? `<div class="doc-meta" style="color:#475569;margin-top:4px;">${escapeHtml(doc.summary.slice(0, 200))}${doc.summary.length > 200 ? '…' : ''}</div>` : '';
                const clarLine = doc.clarification
                    ? `<div class="doc-meta" style="color:#0369a1;margin-top:4px;"><i data-lucide="info"></i> Уточнение: ${escapeHtml(doc.clarification)}</div>` : '';
                const errorLine = doc.status === 'error' && doc.error
                    ? `<div class="doc-meta" style="color:#dc2626;">${escapeHtml(doc.error)}</div>` : '';
                const ownerLine = doc.uploaded_by_name
                    ? `<div class="doc-meta"><i data-lucide="user"></i> Загрузил: ${escapeHtml(doc.uploaded_by_name)}${doc.department ? ' · ' + escapeHtml(doc.department) : ''}${doc.storage_path ? ` · <code>${escapeHtml(doc.storage_path)}</code>` : ''}</div>`
                    : '';
                return `
                    <div class="doc-item" style="flex-direction:column;align-items:stretch;">
                      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                        <div class="doc-info">
                            <div class="doc-name" title="${escapeHtml(doc.filename)}"><span class="fmt-tag ${fmt.cls}">${fmt.label}</span> ${escapeHtml(doc.filename)}</div>
                            ${folderLine}
                            ${summaryLine}
                            <div class="doc-meta">${meta}</div>
                            ${ownerLine}
                            ${clarLine}
                            ${errorLine}
                        </div>
                        <div class="doc-status">
                            <span class="status-badge ${doc.status}">${statusLabel(doc.status)}</span>
                            ${doc.status === 'indexed' ? `<button class="icon-btn" title="Что ИИ нашёл в документе и к каким этапам отнёс" onclick="openSubstageMap(this.dataset.fn)" data-fn="${escapeHtml(doc.filename)}"><i data-lucide="eye"></i> Посмотреть</button>` : ''}
                            ${canEditDoc(doc) ? `<button class="del-btn" onclick="deleteDocument('${escapeHtml(doc.filename)}')">Удалить</button>`
                                              : '<span class="doc-meta" title="Документ суперадмина доступен всем администраторам">общий · только чтение</span>'}
                        </div>
                      </div>
                      ${docProgress(doc)}
                    </div>
                `;
        }

        function canEditDoc(doc) {
            return isOwner || (currentUser && doc.uploaded_by === currentUser.id);
        }

        function folderName(slug) { const f = allFolders.find(x => x.slug === slug); return f ? f.name : slug; }

        // ---------------- Штатное расписание (внутри «Пользователи системы») ----------------
        const STAFFING_LABELS = { full_name: 'ФИО', position: 'Должность', department: 'Подразделение', start_date: 'Дата приёма/выхода' };
        const STAFFING_KEYS = ['full_name', 'position', 'department', 'start_date'];
        let staffingRecords = [];

        function toggleStaffing() {
            const el = document.getElementById('staffing-block');
            el.style.display = el.style.display === 'none' ? '' : 'none';
            if (el.style.display === '') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function staffingPreview(fileArg) {
            const file = fileArg || document.getElementById('staffing-file').files[0];
            const status = document.getElementById('staffing-status');
            const preview = document.getElementById('staffing-preview');
            const result = document.getElementById('staffing-result');
            result.innerHTML = ''; preview.innerHTML = '';
            if (!file) { status.textContent = 'Выберите файл xlsx.'; return; }
            status.textContent = `ИИ разбирает «${file.name}»…`;
            const fd = new FormData(); fd.append('file', file);
            apiJson('/staffing/preview', { method: 'POST', body: fd })
                .then(({ ok, data }) => {
                    if (!ok) { status.innerHTML = `<span class="err">${escapeHtml(data.detail || 'ошибка разбора')}</span>`; return; }
                    staffingRecords = data.records || [];
                    const withName = staffingRecords.filter(r => (r.full_name || '').trim()).length;
                    const exists = staffingRecords.filter(r => r.exists).length;
                    status.textContent = `Найдено строк: ${data.count} (с ФИО: ${withName}, вакансий: ${data.count - withName})`
                        + (exists ? ` · уже есть в системе и будут пропущены: ${exists}` : '') + '. Поля можно отредактировать.';
                    renderStaffingPreview();
                })
                .catch(err => { status.innerHTML = `<span class="err">${escapeHtml(err.message)}</span>`; });
        }

        function renderStaffingPreview() {
            const preview = document.getElementById('staffing-preview');
            if (!staffingRecords.length) {
                preview.innerHTML = '<div class="warn"><i data-lucide="triangle-alert"></i> В таблице не найдено данных. Проверьте файл.</div>';
                refreshIcons();
                return;
            }
            const head = STAFFING_KEYS.map(f => `<th>${STAFFING_LABELS[f]}</th>`).join('') + '<th></th><th></th>';
            const rows = staffingRecords.map((r, i) =>
                `<tr${r.exists ? ' class="row-exists" title="Уже есть в системе — будет пропущен"' : ''}>${STAFFING_KEYS.map(f =>
                    `<td><input type="text" style="width:100%;box-sizing:border-box;" value="${escapeHtml(r[f] || '')}"
                          oninput="staffingRecords[${i}]['${f}']=this.value"></td>`).join('')}
                 <td style="white-space:nowrap;font-size:12px;color:#b45309;">${r.exists ? 'уже есть' : ''}</td>
                 <td><button class="icon-btn danger" title="Убрать строку" onclick="staffingRemoveRow(${i})"><i data-lucide="x"></i></button></td></tr>`).join('');
            const fresh = staffingRecords.filter(r => !r.exists).length;
            preview.innerHTML = `
                <div class="section-head-row" style="margin:14px 0 6px;">
                    <div class="doc-meta muted">Строки с ФИО станут профилями, без ФИО — вакансиями.</div>
                    <button class="primary-btn" onclick="staffingImport()"><i data-lucide="user-plus"></i> Создать (${fresh})</button>
                </div>
                <div style="overflow-x:auto;"><table class="tst" style="font-size:13px;">
                    <thead><tr>${head}</tr></thead><tbody id="staffing-tbody">${rows}</tbody></table></div>`;
            refreshIcons();
        }

        function staffingRemoveRow(i) {
            staffingRecords.splice(i, 1);
            renderStaffingPreview();
        }

        function downloadCredentials(ids) {
            const a = document.createElement('a');
            a.href = '/users/credentials.xlsx' + (ids && ids.length ? '?ids=' + encodeURIComponent(ids.join(',')) : '');
            a.download = 'логины_и_пароли.xlsx';
            document.body.appendChild(a); a.click(); a.remove();
        }

        function staffingImport() {
            if (!staffingRecords.length) return;
            if (!confirm(`Создать записи из ${staffingRecords.length} строк? Уже заведённые будут пропущены.`)) return;
            const status = document.getElementById('staffing-status');
            status.textContent = 'Создаём…';
            apiJson('/staffing/import', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: staffingRecords.map(({ exists, ...r }) => r) })
            }).then(({ ok, data }) => {
                if (!ok) { status.innerHTML = `<span class="err">${escapeHtml(data.detail || 'ошибка создания')}</span>`; return; }
                const profiles = data.profiles || [], vacancies = data.vacancies || [], skipped = data.skipped || [];
                status.textContent = `Профилей: ${profiles.length}, вакансий: ${vacancies.length}, пропущено: ${skipped.length}.`;
                document.getElementById('staffing-preview').innerHTML = '';
                staffingRecords = [];
                const skipRows = skipped.map(s => `<div class="muted">${escapeHtml(s.full_name)} — ${escapeHtml(s.reason)}</div>`).join('');
                document.getElementById('staffing-result').innerHTML = `
                    ${profiles.length ? `<div class="plan-note" style="margin:12px 0;"><i data-lucide="download"></i>
                        Excel с логинами и временными паролями скачан. Повторно — кнопкой «Логины и временные пароли (Excel)»:
                        пароли видны, пока сотрудник не задаст свой.</div>` : ''}
                    ${skipRows ? `<details style="margin-top:8px;"><summary>Пропущены (${skipped.length})</summary>${skipRows}</details>` : ''}`;
                refreshIcons();
                if (profiles.length) downloadCredentials(profiles.map(p => p.id));
                loadEmployees();
            }).catch(err => { status.innerHTML = `<span class="err">${escapeHtml(err.message)}</span>`; });
        }

        // Dropzone штатки: клик выбирает файл, drag-n-drop роняет файл — сразу разбираем.
        (function () {
            const dz = document.getElementById('staffing-dropzone');
            const inp = document.getElementById('staffing-file');
            if (!dz || !inp) return;
            dz.addEventListener('click', () => inp.click());
            inp.addEventListener('change', () => { if (inp.files[0]) staffingPreview(inp.files[0]); inp.value = ''; });
            ['dragenter', 'dragover'].forEach(evt => dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.add('dragover'); }));
            ['dragleave', 'drop'].forEach(evt => dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.remove('dragover'); }));
            dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) staffingPreview(f); });
        })();

        function deleteDocument(filename) {
            if (!confirm(`Удалить документ «${filename}»? Сообщения, написанные по нему, обновятся автоматически.`)) return;
            api(`/documents/${encodeURIComponent(filename)}`, { method: 'DELETE' })
                .then(() => { loadDocuments().then(loadCoverage); loadFolders(); })
                .catch(err => alert(`Ошибка удаления: ${err.message}`));
        }

        // Самопланирующийся опрос: чаще, пока есть незавершённые загрузки; иначе редко.
        let docPollTimer = null;
        function scheduleDocPoll() {
            clearTimeout(docPollTimer);
            docPollTimer = setTimeout(() => {
                loadDocuments().finally(scheduleDocPoll);
            }, (pendingDocs.size || anyReanalyzing) ? 2000 : 8000);
        }
        function bumpDocPolling() { scheduleDocPoll(); }   // ускорить сразу после загрузки файла

        loadDocuments().then(loadCoverage);
        loadFolders();
        scheduleDocPoll();

        // ---------------- Конструктор плана ----------------
        let catalog = null;
        let plan = emptyPlan();
        let builderLoaded = false;
        let pollTimer = null;
        let currentGenJob = null;

        function emptyPlan() {
            return { plan_id: null, title: '', role: '', start_date: '', stages: [] };
        }

        function ensureBuilderLoaded() {
            if (builderLoaded) return;
            builderLoaded = true;
            Promise.all([
                api('/catalog').then(r => r.json()),
                api('/plans').then(r => r.json()),
            ]).then(([cat, plans]) => {
                catalog = cat;
                fillStageCatalogSelect();
                fillPlanSelect(plans.plans || []);
                renderStages();
            }).catch(err => {
                document.getElementById('stages-container').innerHTML =
                    `<div class="error">Не удалось загрузить каталог этапов: ${escapeHtml(err.message)}</div>`;
            });
        }

        function fillStageCatalogSelect() {
            const select = document.getElementById('stage-catalog-select');
            select.innerHTML = catalog.stages
                .map(s => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join('')
                + `<option value="__custom__">＋ Свой этап (создать)</option>`;
        }

        function fillPlanSelect(plans) {
            const select = document.getElementById('plan-select');
            const current = plan.plan_id || '';
            select.innerHTML = `<option value="">＋ Создать свой план</option>` + plans.map(p =>
                `<option value="${escapeHtml(p.plan_id)}">${escapeHtml(p.title)}${p.role ? ' · ' + escapeHtml(p.role) : ''}</option>`
            ).join('');
            select.value = current;
        }

        function refreshPlanList() {
            return api('/plans').then(r => r.json()).then(d => {
                fillPlanSelect(d.plans || []);
                fillEmployeePlanSelect(d.plans || []);
            });
        }

        function onPlanSelect() {
            const id = document.getElementById('plan-select').value;
            if (!id) {
                // «Создать свой план»: пустой редактор, при сохранении создаётся новый план.
                plan = emptyPlan();
                fillPlanMeta();
                renderStages();
                setStatus('Новый план: задайте название, добавьте этапы и подэтапы, затем сохраните.');
                return;
            }
            api(`/plans/${encodeURIComponent(id)}`).then(r => r.json()).then(data => {
                plan = data.plan;
                fillPlanMeta();
                renderStages();
                setStatus('');
            });
        }

        function newPlan() {
            plan = emptyPlan();
            document.getElementById('plan-select').value = '';
            fillPlanMeta();
            renderStages();
            setStatus('');
        }

        function fullTemplatePlan() {
            const title = prompt('Название полного шаблона (единый для всех профессий):', 'Универсальный план адаптации');
            if (title === null) return;
            setStatus('Создаю полный шаблон…');
            api('/plans/template' + (title.trim() ? '?title=' + encodeURIComponent(title.trim()) : ''), { method: 'POST' })
                .then(r => r.json()).then(p => {
                    plan = p;
                    fillPlanMeta();
                    renderStages();
                    refreshPlanList().then(() => { document.getElementById('plan-select').value = p.plan_id; });
                    setStatus('Полный шаблон создан — редактируйте под задачу');
                });
        }

        function deletePlan() {
            if (!plan.plan_id) { newPlan(); return; }
            if (!confirm(`Удалить план «${plan.title}» вместе с его сообщениями? Сотрудники с этим планом останутся без плана.`)) return;
            api(`/plans/${encodeURIComponent(plan.plan_id)}`, { method: 'DELETE' })
                .then(() => { newPlan(); refreshPlanList(); _planTextsLoaded = false; setStatus('План удалён'); });
        }

        function duplicatePlan() {
            if (!plan.plan_id) { setStatus('Сначала сохраните план, потом его можно дублировать'); return; }
            const title = prompt('Название копии (под смежную должность):', `${plan.title} (копия)`);
            if (title === null) return;  // отмена
            const q = title.trim() ? `?title=${encodeURIComponent(title.trim())}` : '';
            apiJson(`/plans/${encodeURIComponent(plan.plan_id)}/duplicate${q}`, { method: 'POST' })
                .then(({ ok, data }) => {
                    if (!ok) { setStatus(data.detail || 'Не удалось дублировать план'); return; }
                    plan = data;
                    fillPlanMeta();
                    renderStages();
                    refreshPlanList().then(() => {
                        document.getElementById('plan-select').value = data.plan_id;
                    });
                    setStatus('Создана копия — отредактируйте под должность и сохраните');
                });
        }

        function fillPlanMeta() {
            document.getElementById('plan-title').value = plan.title || '';
            document.getElementById('plan-delete-btn').style.display = plan.plan_id ? '' : 'none';
        }

        function planField(field, value) { plan[field] = value; }
        function setStatus(text) { document.getElementById('plan-status').textContent = text; }

        const UNIT_TITLES = { hours: 'часы', days: 'дни', weeks: 'недели', months: 'месяцы' };
        const UNIT_DAYS = { hours: 0, days: 1, weeks: 7, months: 30 };

        function stageSpanDays(duration) {
            const value = Math.max(1, parseInt(duration.value, 10) || 1);
            if (duration.unit === 'hours') return Math.max(1, Math.ceil(value / 24));
            return Math.max(1, value * (UNIT_DAYS[duration.unit] || 1));
        }

        function dayChoiceAllowed(duration) { return duration.unit !== 'hours'; }

        function computeOffsets() {
            const offsets = {};
            const before = plan.stages.filter(s => s.anchor === 'before_start');
            const after = plan.stages.filter(s => s.anchor !== 'before_start');
            let cursor = -before.reduce((sum, s) => sum + stageSpanDays(s.duration), 0);
            before.forEach(s => { offsets[s.uid] = cursor; cursor += stageSpanDays(s.duration); });
            cursor = 0;
            after.forEach(s => { offsets[s.uid] = cursor; cursor += stageSpanDays(s.duration); });
            return offsets;
        }

        function shiftDate(startDate, offsetDays) {
            const d = new Date(`${startDate}T00:00:00`);
            d.setDate(d.getDate() + offsetDays);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }

        function sendDateLabel(offsetDays, time) {
            if (offsetDays === 0) return `в день выхода, ${time}`;
            return `${Math.abs(offsetDays)} дн. ${offsetDays > 0 ? 'после' : 'до'} выхода, ${time}`;
        }

        let uidCounter = 0;
        function nextUid(prefix) { uidCounter += 1; return `${prefix}${uidCounter}`; }

        function addStageFromCatalog() {
            const id = document.getElementById('stage-catalog-select').value;
            if (id === '__custom__') {
                plan.stages.push({
                    uid: nextUid('u'), catalog_id: null, title: 'Новый этап', description: '',
                    anchor: 'from_start', duration: { value: 1, unit: 'days' }, substages: [],
                });
            } else {
                const template = catalog.stages.find(s => s.id === id);
                if (!template) return;
                plan.stages.push({
                    uid: nextUid('u'),
                    catalog_id: template.id,
                    title: template.title,
                    description: template.description,
                    anchor: template.anchor,
                    duration: { ...template.default_duration },
                    substages: [],
                });
            }
            renderStages();
        }

        function removeStage(index) { plan.stages.splice(index, 1); renderStages(); }

        function moveStage(index, delta) {
            const target = index + delta;
            if (target < 0 || target >= plan.stages.length) return;
            const [item] = plan.stages.splice(index, 1);
            plan.stages.splice(target, 0, item);
            renderStages();
        }

        function stageField(index, field, value) { plan.stages[index][field] = value; renderStages(); }

        function durationField(index, field, value) {
            plan.stages[index].duration[field] = field === 'value' ? (parseInt(value, 10) || 1) : value;
            const span = stageSpanDays(plan.stages[index].duration);
            plan.stages[index].substages.forEach(sub => {
                sub.schedule.day = Math.max(1, Math.min(span, sub.schedule.day || 1));
            });
            renderStages();
        }

        function substageTemplates(stage) {
            if (!stage.catalog_id || !catalog) return [];
            const found = catalog.stages.find(s => s.id === stage.catalog_id);
            return found ? found.substage_templates : [];
        }

        function addSubstage(stageIndex) {
            const stage = plan.stages[stageIndex];
            const select = document.getElementById(`sub-template-${stageIndex}`);
            const value = select ? select.value : '__custom__';
            const template = substageTemplates(stage).find(t => t.id === value);
            if (template) {
                stage.substages.push({
                    uid: nextUid('s'), catalog_id: template.id, title: template.title,
                    kind: template.kind, brief: template.brief, source: 'template',
                    tags: template.tags || [],
                    schedule: { day: 1, time: template.default_time || '09:00' },
                });
            } else {
                stage.substages.push({
                    uid: nextUid('s'), catalog_id: null, title: 'Новый подэтап',
                    kind: 'message', brief: '', source: 'manual', tags: [],
                    schedule: { day: 1, time: '09:00' },
                });
            }
            renderStages();
        }

        function removeSubstage(stageIndex, subIndex) {
            plan.stages[stageIndex].substages.splice(subIndex, 1);
            renderStages();
        }

        function moveSubstage(stageIndex, subIndex, delta) {
            const subs = plan.stages[stageIndex].substages;
            const target = subIndex + delta;
            if (target < 0 || target >= subs.length) return;
            const [item] = subs.splice(subIndex, 1);
            subs.splice(target, 0, item);
            renderStages();
        }

        function subField(stageIndex, subIndex, field, value) {
            const sub = plan.stages[stageIndex].substages[subIndex];
            if (field === 'brief' || field === 'title') {
                sub[field] = value;
                if (field === 'brief') sub.source = 'manual';
                return; // без перерисовки, чтобы не терять фокус ввода
            }
            sub[field] = value;
            renderStages();
        }

        function subSchedule(stageIndex, subIndex, field, value) {
            const sub = plan.stages[stageIndex].substages[subIndex];
            sub.schedule[field] = field === 'day' ? (parseInt(value, 10) || 1) : value;
            renderStages();
        }

        // Автоподгон высоты textarea под содержимое: поле раскрывается на весь текст,
        // без внутренней прокрутки. Зовём при вводе и после каждой перерисовки плана.
        function autosize(el) {
            if (!el) return;
            el.style.height = 'auto';
            el.style.height = (el.scrollHeight + 2) + 'px';
        }

        function renderStages() {
            const container = document.getElementById('stages-container');
            if (!plan.stages.length) {
                container.innerHTML = `<div class="empty-hint">Этапов пока нет. Выберите этап из списка ниже и добавьте его в план.</div>`;
                return;
            }
            plan.stages.forEach(s => { if (!s.uid) s.uid = nextUid('u'); });
            const offsets = computeOffsets();

            container.innerHTML = plan.stages.map((stage, stageIndex) => {
                const span = stageSpanDays(stage.duration);
                const dayChoice = dayChoiceAllowed(stage.duration);
                const offset = offsets[stage.uid] || 0;
                const templateOptions = substageTemplates(stage).map(t =>
                    `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('')
                    + `<option value="__custom__">＋ Свой подэтап (создать)</option>`;

                const substagesHtml = stage.substages.map((sub, subIndex) => {
                    const dayOptions = Array.from({ length: span }, (_, i) =>
                        `<option value="${i + 1}" ${sub.schedule.day === i + 1 ? 'selected' : ''}>День ${i + 1}</option>`
                    ).join('');
                    const offsetDays = offset + (dayChoice ? (sub.schedule.day || 1) - 1 : 0);
                    const kindOptions = catalog.substage_kinds.map(k =>
                        `<option value="${k.id}" ${sub.kind === k.id ? 'selected' : ''}>${escapeHtml(k.title)}</option>`
                    ).join('');

                    return `
                        <div class="sub-item">
                            <div class="sub-head">
                                <span style="color:#94a3b8;">${subIndex + 1}.</span>
                                <input type="text" value="${escapeHtml(sub.title)}"
                                       oninput="subField(${stageIndex}, ${subIndex}, 'title', this.value)">
                                <button class="icon-btn" onclick="moveSubstage(${stageIndex}, ${subIndex}, -1)"><i data-lucide="chevron-up"></i></button>
                                <button class="icon-btn" onclick="moveSubstage(${stageIndex}, ${subIndex}, 1)"><i data-lucide="chevron-down"></i></button>
                                <button class="icon-btn danger" onclick="removeSubstage(${stageIndex}, ${subIndex})"><i data-lucide="x"></i></button>
                            </div>
                            <div style="margin-top:10px;">
                                <label style="font-size:12px;color:#64748b;">О чём сообщение
                                    <span class="help" title="Задание для ИИ, а не готовый текст. Опишите, что сотрудник должен узнать или сделать в этот момент, например: «Рассказать, где получить пропуск и спецодежду, к кому подойти в первый день». Готовое сообщение ИИ напишет сам по загруженным документам компании — его можно будет поправить на вкладке «Сообщения».">?</span></label>
                                <textarea class="brief-ta" style="overflow-y:hidden;"
                                          oninput="subField(${stageIndex}, ${subIndex}, 'brief', this.value); autosize(this)"
                                          placeholder="Что сотрудник должен узнать или сделать. Например: где получить пропуск и к кому подойти в первый день.">${escapeHtml(sub.brief)}</textarea>
                                ${sub.catalog_id ? '' : `<div class="stage-hint" style="margin-top:4px;">Свой подэтап: подходящие документы подберутся по смыслу названия и описания при сохранении плана${(sub.topic_keys || []).length ? ' · подобрано тем: ' + sub.topic_keys.length : ''}.</div>`}
                            </div>
                            <div class="sub-grid">
                                <div class="field">
                                    <label>Тип <span class="help" title="Сообщение — просто текст. Чек-лист — список дел с отметками. Опрос — вопросы о самочувствии/впечатлениях. Мини-тест — вопросы с вариантами ответа для проверки знаний. Напоминание — короткое напоминание о событии.">?</span></label>
                                    <select onchange="subField(${stageIndex}, ${subIndex}, 'kind', this.value)">${kindOptions}</select>
                                </div>
                                <div class="field">
                                    <label>День внутри этапа <span class="help" title="В какой день этапа отправить сообщение. Этап, заданный в часах, длится меньше суток — выбирается только время.">?</span></label>
                                    <select ${dayChoice ? '' : 'disabled'}
                                            onchange="subSchedule(${stageIndex}, ${subIndex}, 'day', this.value)">
                                        ${dayChoice ? dayOptions : '<option>— этап задан в часах —</option>'}
                                    </select>
                                </div>
                                <div class="field">
                                    <label>Время</label>
                                    <input type="time" value="${escapeHtml(sub.schedule.time)}"
                                           onchange="subSchedule(${stageIndex}, ${subIndex}, 'time', this.value)">
                                </div>
                                <div class="sub-when"><i data-lucide="calendar-days"></i> ${escapeHtml(sendDateLabel(offsetDays, sub.schedule.time))}</div>
                            </div>
                        </div>
                    `;
                }).join('');

                const unitOptions = Object.entries(UNIT_TITLES).map(([id, title]) =>
                    `<option value="${id}" ${stage.duration.unit === id ? 'selected' : ''}>${title}</option>`).join('');

                return `
                    <div class="stage-card">
                        <div class="stage-head">
                            <div style="flex:1;">
                                <input type="text" class="stage-title-input" value="${escapeHtml(stage.title)}"
                                       oninput="plan.stages[${stageIndex}].title = this.value">
                            </div>
                            <div>
                                <button class="icon-btn" onclick="moveStage(${stageIndex}, -1)"><i data-lucide="chevron-up"></i></button>
                                <button class="icon-btn" onclick="moveStage(${stageIndex}, 1)"><i data-lucide="chevron-down"></i></button>
                                <button class="icon-btn danger" onclick="removeStage(${stageIndex})">Удалить этап</button>
                            </div>
                        </div>
                        ${stage.description ? `<div class="stage-hint">${escapeHtml(stage.description)}</div>` : ''}
                        <div class="stage-controls">
                            <div class="field">
                                <label>Длительность</label>
                                <input type="number" min="1" style="width:90px;" value="${stage.duration.value}"
                                       onchange="durationField(${stageIndex}, 'value', this.value)">
                            </div>
                            <div class="field">
                                <label>Единица</label>
                                <select onchange="durationField(${stageIndex}, 'unit', this.value)">${unitOptions}</select>
                            </div>
                            <div class="field">
                                <label>Отсчёт <span class="help" title="«До выхода на работу» — этап идёт перед первым рабочим днём (приглашение, документы). «От даты выхода» — после.">?</span></label>
                                <select onchange="stageField(${stageIndex}, 'anchor', this.value)">
                                    <option value="from_start" ${stage.anchor !== 'before_start' ? 'selected' : ''}>от даты выхода</option>
                                    <option value="before_start" ${stage.anchor === 'before_start' ? 'selected' : ''}>до выхода на работу</option>
                                </select>
                            </div>
                            <div class="stage-hint">
                                ${span} кал. дн. · старт этапа ${offset >= 0 ? '+' : ''}${offset} дн. от даты выхода
                                ${dayChoice ? '' : ' · день не выбирается, только время'}
                            </div>
                        </div>

                        <div style="margin-top:14px;">${substagesHtml || '<div class="empty-hint">Подэтапов пока нет.</div>'}</div>

                        <div class="add-row">
                            <select id="sub-template-${stageIndex}">${templateOptions}</select>
                            <button class="ghost-btn" onclick="addSubstage(${stageIndex})">＋ Добавить подэтап</button>
                        </div>
                    </div>
                `;
            }).join('');

            // После перерисовки раскрываем все поля брифов на всю высоту текста.
            container.querySelectorAll('textarea.brief-ta').forEach(autosize);
        }

        function planPayload() {
            return {
                title: plan.title || 'План адаптации',
                stages: plan.stages.map(stage => ({
                    id: stage.id || null,
                    catalog_id: stage.catalog_id,
                    title: stage.title,
                    description: stage.description || '',
                    anchor: stage.anchor,
                    duration: stage.duration,
                    substages: stage.substages.map(sub => ({
                        id: sub.id || null,
                        catalog_id: sub.catalog_id,
                        title: sub.title,
                        kind: sub.kind,
                        brief: sub.brief,
                        source: sub.source,
                        tags: sub.tags || [],
                        schedule: sub.schedule,
                    })),
                })),
            };
        }

        function savePlan() {
            if (!(plan.title || '').trim()) { setStatus('Укажите название плана'); return Promise.resolve(); }
            if (!plan.stages.some(s => s.substages.length)) { setStatus('Добавьте хотя бы один этап с подэтапом'); return Promise.resolve(); }
            setStatus('Сохранение...');
            // Нет plan_id — это новый («Создать свой план»): POST, иначе правка существующего.
            return api(plan.plan_id ? `/plans/${encodeURIComponent(plan.plan_id)}` : '/plans', {
                method: plan.plan_id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(planPayload()),
            })
                .then(res => res.json().then(d => { if (!res.ok) throw new Error(d.detail || 'ошибка'); return d; }))
                .then(saved => {
                    _planTextsLoaded = false;   // список планов на вкладке «Сообщения» обновится
                    const uids = plan.stages.map(s => ({ uid: s.uid, subs: s.substages.map(x => x.uid) }));
                    plan = saved;
                    plan.stages.forEach((stage, i) => {
                        stage.uid = (uids[i] || {}).uid || nextUid('u');
                        stage.substages.forEach((sub, j) => {
                            sub.uid = ((uids[i] || {}).subs || [])[j] || nextUid('s');
                        });
                    });
                    fillPlanMeta();
                    renderStages();
                    setStatus(`Сохранено: ${saved.title}. Дальше — вкладка «Сообщения».`);
                    renderNextStep();
                    return refreshPlanList().then(() => {
                        document.getElementById('plan-select').value = saved.plan_id;
                    });
                })
                .catch(err => setStatus(`Ошибка сохранения: ${err.message}`));
        }

        // ---------------- Генерация во вкладке «Сообщения» ----------------
        function ptSetStatus(text) { document.getElementById('pt-status').textContent = text || ''; }
        function ptSetBusy(busy) {
            document.getElementById('pt-generate-btn').disabled = busy;
            document.getElementById('pt-cancel-btn').style.display = busy ? '' : 'none';
        }

        // Одна кнопка: сервер сверяет SHA-256 отпечатки (документы, описание подэтапа, должность)
        // и зовёт ИИ только там, где что-то изменилось или сообщения нет. Перед запуском
        // показываем, сколько будет запросов, — дорогие запуски только с подтверждением.
        function ptGeneratePlan() {
            const pid = document.getElementById('pt-plan').value;
            if (!pid) { ptSetStatus('Выберите план.'); return; }
            const prof = document.getElementById('pt-prof').value;
            // Должность выбрана — только её сообщения; «Общие» — все должности адресатов плана.
            const q = prof ? `?profession=${encodeURIComponent(prof)}` : '';
            ptSetBusy(true);
            ptSetStatus('Проверяем, что изменилось…');
            apiJson(`/plans/${encodeURIComponent(pid)}/generate-estimate${q}`).then(({ ok, data }) => {
                if (!ok) { ptSetStatus(data.detail || 'Не удалось проверить'); ptSetBusy(false); return; }
                if (!data.llm_calls) {
                    ptSetStatus(`Всё актуально — запросов к ИИ не нужно (актуальных: ${data.up_to_date}, без документов: ${data.skipped}).`);
                    ptSetBusy(false);
                    return;
                }
                const scope = prof ? `должность «${prof}»` : `должностей: ${data.professions}`;
                if (data.llm_calls > 5 && !confirm(`Будет сгенерировано сообщений: ${data.llm_calls} (${scope}).\n`
                    + `Актуальные (${data.up_to_date}) не трогаем. Запустить?`)) { ptSetStatus(''); ptSetBusy(false); return; }
                ptStartJob(`/plans/${encodeURIComponent(pid)}/generate${q}`, prof ? `Должность: ${prof}` : 'Все должности');
            }).catch(err => { ptSetStatus(err.message); ptSetBusy(false); });
        }

        function ptStartJob(url, prefix) {
            ptSetStatus('Генерация…');
            apiJson(url, { method: 'POST' })
                .then(({ ok, data }) => {
                    if (!ok) { ptSetStatus(data.detail || 'Не удалось запустить генерацию'); ptSetBusy(false); return; }
                    if (data.status === 'up_to_date') { ptSetStatus('Всё актуально — запросов к ИИ не нужно.'); ptSetBusy(false); return; }
                    if (data.already_running) ptSetStatus('Генерация этого плана уже идёт — показываем её ход.');
                    currentGenJob = data.job_id;
                    ptPollJob(data.job_id, () => { renderPlanTexts(); loadPlanTexts(); }, prefix);
                })
                .catch(err => { ptSetStatus(err.message); ptSetBusy(false); });
        }

        function ptPollJob(jobId, onDone, prefix) {
            const wrap = document.getElementById('pt-progress-wrap');
            const fill = document.getElementById('pt-progress-fill');
            const label = document.getElementById('pt-progress-label');
            wrap.style.display = 'block';
            clearInterval(pollTimer);
            const pre = prefix ? `${prefix} · ` : '';
            pollTimer = setInterval(() => {
                api(`/jobs/${encodeURIComponent(jobId)}`).then(r => r.json()).then(job => {
                    const percent = job.total ? Math.round(100 * job.done / job.total) : 0;
                    fill.style.width = `${percent}%`;
                    const extra = `${job.reused ? ' · актуальных: ' + job.reused : ''}${job.skipped ? ' · без документов: ' + job.skipped : ''}${job.errors ? ' · ошибок: ' + job.errors : ''}`;
                    const calls = `запросов к ИИ: ${job.llm_calls || 0}${job.llm_planned ? ' из ~' + job.llm_planned : ''}`;
                    label.textContent = job.status === 'running' || job.status === 'queued'
                        ? `${pre}${job.done} из ${job.total} · ${calls}${job.current ? ' · ' + job.current : ''}${extra}`
                        : `${pre}Статус: ${job.status} · ${calls}${extra}`;
                    if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
                        clearInterval(pollTimer);
                        currentGenJob = null;
                        ptSetBusy(false);
                        const skippedNote = job.skipped ? ` · без документов: ${job.skipped} — загрузите документы, эти сообщения допишутся сами` : '';
                        ptSetStatus(job.status === 'done' ? `Готово · ${calls}${skippedNote}`
                            : job.status === 'cancelled' ? 'Остановлено (сгенерированное сохранено)'
                            : (job.error || 'Ошибка'));
                        if (onDone) onDone();
                        renderNextStep();
                    }
                }).catch(() => clearInterval(pollTimer));
            }, 1500);
        }

        function ptCancelGeneration() {
            if (!currentGenJob) return;
            ptSetStatus('Остановка…');
            api(`/jobs/${encodeURIComponent(currentGenJob)}/cancel`, { method: 'POST' }).catch(() => {});
        }

        // ---------------- Ручная правка текста сообщения ----------------
        function editPlanText(mid, btn) {
            const sub = btn.closest('.pt-sub');
            if (!sub) return;
            const cur = decodeURIComponent(sub.querySelector('.pt-text').dataset.raw || '');
            const ta = document.createElement('textarea');
            ta.className = 'pt-edit'; ta.value = cur;
            ta.style.cssText = 'width:100%;min-height:140px;margin-top:6px;';
            const bar = document.createElement('div');
            bar.style.cssText = 'display:flex;gap:8px;margin-top:6px;';
            bar.innerHTML = `<button class="primary-btn" onclick="savePlanText('${escapeHtml(mid)}', this)"><i data-lucide="save"></i> Сохранить</button>
                             <button class="ghost-btn" onclick="renderPlanTexts()">Отмена</button>`;
            sub.querySelector('.pt-text').after(ta);
            ta.after(bar);
            btn.style.display = 'none';
            refreshIcons();
            ta.focus();
        }

        function savePlanText(mid, btn) {
            const pid = document.getElementById('pt-plan').value;
            const prof = document.getElementById('pt-prof').value || '';
            const sub = btn.closest('.pt-sub');
            const ta = sub && sub.querySelector('.pt-edit');
            if (!pid || !ta) return;
            btn.disabled = true;
            apiJson(`/plans/${encodeURIComponent(pid)}/messages/${encodeURIComponent(mid)}`,
                { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ta.value, profession: prof }) })
                .then(({ ok, data }) => {
                    if (!ok) { btn.disabled = false; alert(data.detail || 'Не удалось сохранить'); return; }
                    renderPlanTexts();
                })
                .catch(err => { btn.disabled = false; alert(err.message); });
        }

        function whenLabel(msg) {
            if (msg.schedule.send_at) return msg.schedule.send_at.replace('T', ' ');
            const anchor = msg.schedule.anchor === 'before_start' ? 'до выхода' : 'от выхода';
            const offset = msg.schedule.offset_days;
            return `${offset >= 0 ? '+' : ''}${offset} дн. (${anchor}), ${msg.schedule.time}`;
        }

        function messageRows(messages, withRegenerate) {
            return (messages || []).map(msg => `
                <tr>
                    <td>${msg.stage.order}. ${escapeHtml(msg.stage.title)}</td>
                    <td>${msg.substage.order}. ${escapeHtml(msg.substage.title)}<div class="msg-meta">${escapeHtml(msg.substage.kind)}</div></td>
                    <td style="white-space:nowrap;">${escapeHtml(whenLabel(msg))}</td>
                    <td>
                        <div class="msg-text">${escapeHtml(msg.content.text || '—')}</div>
                        ${msg.error ? `<div class="msg-error"><i data-lucide="triangle-alert"></i> ${escapeHtml(msg.error)}</div>` : ''}
                        <div class="msg-meta">
                            ${msg.folders_used && msg.folders_used.length ? '' + escapeHtml(msg.folders_used.join(', ')) + ' · ' : ''}
                            ${msg.sources && msg.sources.length ? '' + escapeHtml([...new Set(msg.sources.map(s => s.source))].join(', ')) : ''}
                        </div>
                    </td>
                </tr>
            `).join('');
        }

        // ---------------- Пользователи системы ----------------
        let employeesLoaded = false;
        let editingEmployeeId = null;
        let employeesCache = [];
        const selectedUsers = new Set();   // отмеченные галочками — для массового удаления
        // Должности, под которые уже сгенерирован план адаптации (для пометки ✓ в комбобоксе должности).
        let profReadySet = new Set();
        let defaultPlanId = null;
        function loadProfReady(planId) {
            defaultPlanId = planId || null;
            if (!defaultPlanId) { profReadySet = new Set(); return; }
            api(`/plans/${encodeURIComponent(defaultPlanId)}/professions`)
                .then(r => r.ok ? r.json() : {})
                .then(d => { profReadySet = new Set(d.generated_names || []); })
                .catch(() => {});
        }
        function deleteProfPlan(prof) {
            if (!defaultPlanId) { alert('Общий план не назначен — удалять нечего.'); return; }
            if (!confirm(`Удалить сгенерированные сообщения плана для должности «${prof}»?`)) return;
            api(`/plans/${encodeURIComponent(defaultPlanId)}/schedule?profession=${encodeURIComponent(prof)}`,
                { method: 'DELETE' }).then(r => r.json().then(d => ({ ok: r.ok, d })))
                .then(({ ok, d }) => {
                    if (!ok) { alert(d.detail || 'Не удалось удалить'); return; }
                    profReadySet.delete(prof);
                    comboRender(document.getElementById('combo-search').value);
                }).catch(() => alert('Ошибка сети'));
        }

        // Логин и пароль сюда не входят: логин создаётся из ФИО один раз, пароль — «Доступ».
        // Статус тоже: он считается сам по дате выхода (пауза — отдельной кнопкой).
        const PROFILE_FIELDS = ['full_name', 'position', 'department', 'phone', 'email',
                                'mentor', 'manager', 'plan_id', 'start_date', 'notes'];
        const EMPLOYEE_STATUS_TITLES = {
            planned: 'Запланирован', active: 'Проходит адаптацию',
            paused: 'Приостановлен', done: 'Завершил',
        };
        const ROLE_TITLES = { owner: 'Суперадмин', admin: 'Администратор', employee: 'Сотрудник' };

        function ensureEmployeesLoaded() {
            if (employeesLoaded) return;
            employeesLoaded = true;
            api('/plans').then(r => r.json()).then(d => { fillEmployeePlanSelect(d.plans || []); loadProfReady(d.default_plan_id); });
            loadEmployees();
        }

        function fillEmployeePlanSelect(plans) {
            const select = document.getElementById('emp-plan_id');
            const current = select.value;
            select.innerHTML = `<option value="">— план не назначен —</option>` + plans.map(p =>
                `<option value="${escapeHtml(p.plan_id)}">${p.generated ? '✓ ' : ''}${escapeHtml(p.title)}${p.generated ? ' — сообщения готовы' : ' — без сообщений'}</option>`
            ).join('');
            select.value = current;
        }

        function loadEmployees() {
            api('/users').then(r => r.json()).then(d => {
                employeesCache = d.users || [];
                fillDeptFilter();
                renderEmployees(employeesCache);
                renderNextStep();
            }).catch(() => {});
        }

        // ---- Справочник подразделений: строится из штатки (профилей), как справочник должностей ----
        function departmentList() {
            return [...new Set(employeesCache.map(u => (u.department || '').trim()).filter(Boolean))]
                .sort((a, b) => a.localeCompare(b, 'ru'));
        }
        function fillDeptFilter() {
            const sel = document.getElementById('dept-filter');
            const cur = sel.value;
            sel.innerHTML = '<option value="">Все подразделения</option>'
                + departmentList().map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
            sel.value = departmentList().includes(cur) ? cur : '';
        }

        // ---- Combobox с поиском: клик по полю -> скроллируемый список + строка поиска ----
        function comboPositions() { return [...new Set(employeesCache.map(u => (u.position || '').trim()).filter(Boolean))].sort(); }
        // Наставник/руководитель — реальные люди: без вакансий и без самого редактируемого.
        function comboUserNames() {
            return [...new Set(employeesCache
                .filter(u => u.id !== editingEmployeeId && !(u.full_name || '').startsWith('(вакансия)'))
                .map(u => (u.full_name || '').trim()).filter(Boolean))].sort();
        }
        // Поля, где можно добавить своё значение (нет в списке): должность и подразделение.
        const COMBO_FREE = new Set(['emp-position', 'emp-department']);

        let comboTarget = null, comboAll = [];
        function comboEls() {
            let panel = document.getElementById('combo-panel');
            if (!panel) {
                panel = document.createElement('div');
                panel.className = 'combo-panel';
                panel.id = 'combo-panel';
                panel.innerHTML = `<input type="text" class="combo-search" id="combo-search" placeholder="Поиск…"><ul class="combo-list" id="combo-list"></ul>`;
                // Панель внутри открытого <dialog>, иначе она окажется под модальным окном.
                (document.querySelector('dialog[open]') || document.body).appendChild(panel);
                document.getElementById('combo-search').addEventListener('input', e => comboRender(e.target.value));
                document.getElementById('combo-search').addEventListener('keydown', e => {
                    // Escape закрывает только список; фокус снимаем со скрытого поиска, чтобы
                    // следующий Escape закрыл окно карточки.
                    if (e.key === 'Escape') { e.preventDefault(); comboClose(); e.target.blur(); return; }
                    if (e.key === 'Enter' && comboTarget && COMBO_FREE.has(comboTarget.id)) {
                        const raw = e.target.value.trim();
                        if (raw) { e.preventDefault(); commitCombo(raw); }
                    }
                });
                document.addEventListener('mousedown', e => {
                    if (panel.classList.contains('open') && !panel.contains(e.target) && e.target !== comboTarget) comboClose();
                });
            }
            const host = document.querySelector('dialog[open]') || document.body;
            if (panel.parentElement !== host) host.appendChild(panel);
            return panel;
        }
        function commitCombo(v) {
            if (comboTarget) { comboTarget.value = v; comboTarget.dispatchEvent(new Event('input')); }
            comboClose();
        }
        function comboRender(query) {
            const raw = (query || '').trim();
            const q = raw.toLowerCase();
            // Должность: ✓ у тех, под которые уже сгенерирован план адаптации (profReadySet).
            const isPos = comboTarget && comboTarget.id === 'emp-position';
            const free = comboTarget && COMBO_FREE.has(comboTarget.id);
            const items = comboAll.filter(v => v.toLowerCase().includes(q));
            const list = document.getElementById('combo-list');
            list.innerHTML = '';
            const exact = items.some(v => v.toLowerCase() === q);
            if (comboTarget && comboTarget.value.trim()) {
                const li = document.createElement('li');
                li.className = 'combo-clear';
                li.textContent = '— очистить —';
                li.addEventListener('mousedown', e => { e.preventDefault(); commitCombo(''); });
                list.appendChild(li);
            }
            if (free && raw && !exact) {
                const li = document.createElement('li');
                li.className = 'combo-add';
                li.textContent = `Добавить: «${raw}»`;
                li.addEventListener('mousedown', e => { e.preventDefault(); commitCombo(raw); });
                list.appendChild(li);
            }
            if (!items.length && !(free && raw)) { list.innerHTML += '<li class="empty">ничего не найдено</li>'; return; }
            items.forEach(v => {
                const li = document.createElement('li');
                const ready = isPos && profReadySet.has(v);
                const label = document.createElement('span');
                label.textContent = (ready ? '✓ ' : '') + v;
                label.addEventListener('mousedown', e => { e.preventDefault(); commitCombo(v); });
                li.appendChild(label);
                if (ready) {
                    li.classList.add('combo-ready'); li.title = 'План адаптации готов';
                    const del = document.createElement('span');
                    del.className = 'combo-del'; del.textContent = '✕'; del.title = 'Удалить сообщения плана для должности';
                    del.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); deleteProfPlan(v); });
                    li.appendChild(del);
                } else if (isPos) { li.title = 'Сообщений ещё нет — сгенерируйте на вкладке «Сообщения»'; }
                if (!ready) li.addEventListener('mousedown', e => { e.preventDefault(); commitCombo(v); });
                list.appendChild(li);
            });
        }
        // Панель position:fixed — координаты вьюпорта. Пересчитываем их на КАЖДЫЙ скролл/ресайз,
        // пока список открыт, иначе панель «отклеивается» от поля при прокрутке страницы.
        function comboPosition() {
            const panel = document.getElementById('combo-panel');
            if (!comboTarget || !panel || !panel.classList.contains('open')) return;
            const r = comboTarget.getBoundingClientRect();
            panel.style.left = r.left + 'px';
            panel.style.top = (r.bottom + 4) + 'px';
            panel.style.width = Math.max(r.width, 240) + 'px';
        }
        function comboOpen(input, items) {
            const panel = comboEls();
            comboTarget = input; comboAll = items;
            const s = document.getElementById('combo-search');
            s.value = '';
            comboRender('');
            panel.classList.add('open');
            comboPosition();
            s.focus();
            // capture=true — ловим скролл любого прокручиваемого предка, не только window.
            window.addEventListener('scroll', comboPosition, true);
            window.addEventListener('resize', comboPosition);
        }
        function comboClose() {
            const p = document.getElementById('combo-panel');
            if (p) p.classList.remove('open');
            comboTarget = null;
            window.removeEventListener('scroll', comboPosition, true);
            window.removeEventListener('resize', comboPosition);
        }

        // Привязка полей карточки к combobox (клик открывает список всех значений с поиском).
        (function () {
            const binds = { 'emp-position': comboPositions, 'emp-department': departmentList,
                            'emp-mentor': comboUserNames, 'emp-manager': comboUserNames };
            Object.entries(binds).forEach(([id, provider]) => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('focus', () => comboOpen(el, provider()));
                    el.addEventListener('click', () => comboOpen(el, provider()));
                }
            });
        })();

        function roleBadge(user) {
            const cls = user.role === 'employee' ? 'planned' : 'active';
            return `<span class="status-badge ${cls}">${escapeHtml(ROLE_TITLES[user.role] || user.role)}</span>`;
        }

        function canManageRow(user) {
            return isOwner || user.role === 'employee';
        }

        function userActions(user) {
            const id = user.id;
            const isSelf = currentUser && currentUser.id === id;
            const buttons = [`<button class="icon-btn" onclick="showEmployeeSchedule('${id}')"><i data-lucide="calendar-days"></i> Расписание</button>`];
            // Обычный администратор правит только сотрудников — админов и суперадминов трогать нельзя.
            // Роль меняет суперадмин в окне «Изменить».
            if (canManageRow(user)) {
                buttons.push(`<button class="icon-btn" onclick="openEmployeeDialog('${id}')"><i data-lucide="pencil"></i> Изменить</button>`);
                buttons.push(`<button class="icon-btn" onclick="openCredentialsDialog('${id}')"><i data-lucide="key-round"></i> Доступ</button>`);
                if (user.role === 'employee' && user.plan_id) {
                    buttons.push(user.status === 'paused'
                        ? `<button class="icon-btn" onclick="setUserPaused('${id}', false)" title="Возобновить доставку сообщений плана"><i data-lucide="play"></i> Возобновить</button>`
                        : `<button class="icon-btn" onclick="setUserPaused('${id}', true)" title="Больничный и т.п.: сообщения плана не приходят, пока не возобновите"><i data-lucide="pause"></i> Приостановить</button>`);
                }
                if (!isSelf) {
                    buttons.push(user.active
                        ? `<button class="icon-btn" onclick="setUserActive('${id}', false)" title="Запретить вход в систему"><i data-lucide="ban"></i> Заблокировать</button>`
                        : `<button class="icon-btn" onclick="setUserActive('${id}', true)"><i data-lucide="check"></i> Подтвердить</button>`);
                    buttons.push(`<button class="icon-btn danger" onclick="deleteEmployee('${id}')"><i data-lucide="x"></i> Удалить</button>`);
                }
            }
            return buttons.join(' ');
        }

        function loginCell(e) {
            if (!e.username) return '<span style="color:#b45309;">нет логина — выдайте доступ</span>';
            const tmp = e.temp_password
                ? ` · временный пароль: <code class="mono">${escapeHtml(e.temp_password)}</code>` : '';
            return '@' + escapeHtml(e.username) + tmp;
        }

        function renderEmployees(list) {
            const container = document.getElementById('employee-list');
            const pending = list.filter(u => !u.active);
            document.getElementById('pending-block').innerHTML = pending.length
                ? `<div class="warn"><i data-lucide="clock"></i> Ждут подтверждения: ${pending.map(u => escapeHtml(u.full_name)).join(', ')}.
                   Пока учётная запись не подтверждена, войти в систему нельзя.</div>`
                : '';

            const dept = document.getElementById('dept-filter').value;
            const shown = dept ? list.filter(u => (u.department || '').trim() === dept) : list;
            [...selectedUsers].forEach(id => { if (!shown.some(u => u.id === id)) selectedUsers.delete(id); });
            updateBulkButton();

            if (!shown.length) {
                container.innerHTML = `<div class="empty-hint">${list.length
                    ? 'В этом подразделении никого нет.'
                    : 'Пользователей пока нет — загрузите штатное расписание или добавьте сотрудника вручную.'}</div>`;
                return;
            }
            const selectable = shown.filter(u => canManageRow(u) && !(currentUser && currentUser.id === u.id));
            const allOn = selectable.length && selectable.every(u => selectedUsers.has(u.id));
            container.innerHTML = `
                <table class="schedule">
                    <thead><tr>
                        <th style="width:28px;"><input type="checkbox" title="Отметить всех" ${allOn ? 'checked' : ''} onchange="toggleAllUsers(this.checked)"></th>
                        <th>Пользователь</th><th>Роль</th><th>План адаптации</th>
                        <th>Дата выхода</th><th>Статус</th><th>Действия</th>
                    </tr></thead>
                    <tbody>${shown.map(e => `
                        <tr${e.active ? '' : ' style="background:#fffbeb;"'}>
                            <td>${selectable.includes(e) ? `<input type="checkbox" ${selectedUsers.has(e.id) ? 'checked' : ''} onchange="toggleUser('${e.id}', this.checked)">` : ''}</td>
                            <td>
                                <strong>${escapeHtml(e.full_name)}</strong>
                                <div class="msg-meta">${loginCell(e)}</div>
                                <div class="msg-meta">${escapeHtml([e.position, e.department].filter(Boolean).join(' · ') || '—')}</div>
                                ${e.active ? '' : '<div class="msg-meta" style="color:#b45309;">не подтверждён</div>'}
                            </td>
                            <td>${roleBadge(e)}</td>
                            <td>
                                ${e.plan_title ? escapeHtml(e.plan_title) : '<span style="color:#dc2626;">не назначен</span>'}
                                ${e.plan_title && !e.plan_generated ? '<div class="msg-meta" style="color:#b45309;">сообщения не сгенерированы</div>' : ''}
                            </td>
                            <td style="white-space:nowrap;">${escapeHtml(e.start_date || '—')}</td>
                            <td><span class="status-badge ${e.status}">${escapeHtml(EMPLOYEE_STATUS_TITLES[e.status] || e.status)}</span></td>
                            <td>${userActions(e)}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>
            `;
        }

        function toggleUser(id, on) { on ? selectedUsers.add(id) : selectedUsers.delete(id); updateBulkButton(); }
        function toggleAllUsers(on) {
            const dept = document.getElementById('dept-filter').value;
            employeesCache.filter(u => (!dept || (u.department || '').trim() === dept)
                && canManageRow(u) && !(currentUser && currentUser.id === u.id))
                .forEach(u => on ? selectedUsers.add(u.id) : selectedUsers.delete(u.id));
            renderEmployees(employeesCache);
        }
        function updateBulkButton() {
            const btn = document.getElementById('bulk-delete-btn');
            btn.style.display = selectedUsers.size ? '' : 'none';
            btn.innerHTML = `<i data-lucide="user-x"></i> Удалить отмеченных (${selectedUsers.size})`;
        }
        function bulkDelete() {
            const names = employeesCache.filter(u => selectedUsers.has(u.id)).map(u => u.full_name);
            if (!names.length) return;
            const preview = names.slice(0, 10).join('\n') + (names.length > 10 ? `\n…и ещё ${names.length - 10}` : '');
            if (!confirm(`Удалить ${names.length} пользовател(я/ей) безвозвратно?\n\n${preview}`)) return;
            apiJson('/users/bulk-delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [...selectedUsers] }),
            }).then(({ ok, data }) => {
                if (!ok) { alert(data.detail || 'Не удалось удалить'); return; }
                const skipped = (data.skipped || []).map(s => `${s.full_name} — ${s.reason}`).join('\n');
                alert(`Удалено: ${data.deleted}.${skipped ? '\nНе удалены:\n' + skipped : ''}`);
                selectedUsers.clear();
                document.getElementById('employee-schedule').innerHTML = '';
                loadEmployees();
            });
        }

        function employeePayload() {
            const payload = {};
            PROFILE_FIELDS.forEach(field => {
                payload[field] = document.getElementById(`emp-${field}`).value || null;
            });
            return payload;
        }

        // Карточка сотрудника — во всплывающем окне: страница не прыгает наверх к форме.
        function openEmployeeDialog(id) {
            const employee = id ? employeesCache.find(e => e.id === id) : null;
            editingEmployeeId = employee ? id : null;
            PROFILE_FIELDS.forEach(field => {
                document.getElementById(`emp-${field}`).value = employee ? (employee[field] || '') : '';
            });
            document.getElementById('emp-username').value = employee ? (employee.username || '') : '';
            const roleField = document.getElementById('emp-role-field');
            const showRole = isOwner && employee && !(currentUser && currentUser.id === id);
            roleField.style.display = showRole ? '' : 'none';
            if (showRole) document.getElementById('emp-role').value = employee.role;
            document.getElementById('employee-form-title').textContent =
                employee ? `Редактирование: ${employee.full_name}` : 'Новый сотрудник';
            document.getElementById('employee-status').textContent = '';
            document.getElementById('employee-dialog').showModal();
            refreshIcons();
        }
        function closeEmployeeDialog() { comboClose(); document.getElementById('employee-dialog').close(); }

        const ROLE_CONFIRM = {
            owner: 'Сделать суперадмином? Полный доступ: все документы, все сотрудники, раздача прав.',
            admin: 'Сделать администратором? Доступ к документам, планам и сотрудникам своего подразделения.',
            employee: 'Сделать обычным сотрудником? Доступ к админке пропадёт.',
        };

        async function saveEmployee() {
            const status = document.getElementById('employee-status');
            const payload = employeePayload();
            if (!payload.full_name) { status.textContent = 'Укажите ФИО'; return; }
            const id = editingEmployeeId;
            const before = id ? employeesCache.find(e => e.id === id) : null;
            const { ok, data } = await apiJson(id ? `/users/${encodeURIComponent(id)}` : '/users', {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!ok) { status.textContent = data.detail || 'Не удалось сохранить'; return; }
            const role = document.getElementById('emp-role').value;
            if (before && isOwner && document.getElementById('emp-role-field').style.display !== 'none'
                && role !== before.role && confirm(ROLE_CONFIRM[role])) {
                const r = await apiJson(`/users/${encodeURIComponent(id)}/role`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
                });
                if (!r.ok) alert(r.data.detail || 'Роль не изменена');
            }
            closeEmployeeDialog();
            if (!id) {
                alert(`Сотрудник создан.\nЛогин: ${data.username}\nВременный пароль: ${data.temp_password}\n\n`
                    + 'Пароль виден в списке и в Excel, пока сотрудник не задаст свой.');
            }
            loadEmployees();
        }

        function deleteEmployee(id) {
            const employee = employeesCache.find(e => e.id === id);
            if (!confirm(`Удалить пользователя «${employee ? employee.full_name : id}»? Действие необратимо.`)) return;
            apiJson(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(({ ok, data }) => {
                if (!ok) { alert(data.detail || 'Не удалось удалить'); return; }
                selectedUsers.delete(id);
                document.getElementById('employee-schedule').innerHTML = '';
                loadEmployees();
            });
        }

        function setUserActive(id, active) {
            apiJson(`/users/${encodeURIComponent(id)}/active`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active }),
            }).then(({ ok, data }) => {
                if (!ok) { alert(data.detail || 'Не удалось изменить'); return; }
                loadEmployees();
            });
        }

        function setUserPaused(id, paused) {
            const employee = employeesCache.find(e => e.id === id);
            if (paused && !confirm(`Приостановить адаптацию «${employee ? employee.full_name : ''}»? Сообщения плана не будут приходить, пока не возобновите.`)) return;
            apiJson(`/users/${encodeURIComponent(id)}/pause`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }),
            }).then(({ ok, data }) => {
                if (!ok) { alert(data.detail || 'Не удалось изменить'); return; }
                loadEmployees();
            });
        }

        function openCredentialsDialog(id) {
            const employee = employeesCache.find(e => e.id === id);
            document.getElementById('cred-user-id').value = id;
            document.getElementById('cred-login').textContent = employee.username || 'создастся из ФИО';
            document.getElementById('cred-password').value = '';
            document.getElementById('cred-title').textContent = `Доступ: ${employee.full_name}`;
            document.getElementById('cred-error').style.display = 'none';
            document.getElementById('cred-result').style.display = 'none';
            document.getElementById('cred-submit').disabled = false;
            document.getElementById('credentials-dialog').showModal();
        }

        function submitCredentials() {
            const id = document.getElementById('cred-user-id').value;
            const errorBox = document.getElementById('cred-error');
            const password = document.getElementById('cred-password').value;
            const btn = document.getElementById('cred-submit');
            btn.disabled = true;
            apiJson(`/users/${encodeURIComponent(id)}/credentials`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password || null }),
            }).then(({ ok, data }) => {
                if (!ok) {
                    btn.disabled = false;
                    errorBox.textContent = data.detail || 'Не удалось сохранить';
                    errorBox.style.display = 'block';
                    return;
                }
                const res = document.getElementById('cred-result');
                res.innerHTML = `Логин: <b>${escapeHtml(data.username)}</b> · временный пароль: <code class="mono">${escapeHtml(data.temp_password)}</code>`;
                res.style.display = 'block';
                loadEmployees();
            });
        }

        function showEmployeeSchedule(id) {
            const container = document.getElementById('employee-schedule');
            container.innerHTML = `<div class="empty-hint">Считаем расписание...</div>`;
            apiJson(`/users/${encodeURIComponent(id)}/schedule`).then(({ ok, data }) => {
                if (!ok) {
                    container.innerHTML = `<div class="warn"><i data-lucide="triangle-alert"></i> ${escapeHtml(data.detail)}</div>`;
                    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    return;
                }
                const base = `/users/${encodeURIComponent(id)}/export`;
                const notGenerated = !data.plan_generated
                    ? `<div class="warn"><i data-lucide="triangle-alert"></i> У плана «${escapeHtml(data.plan_title)}» ещё нет сообщений.
                       Даты рассчитаны, тексты пустые — обновите сообщения на вкладке «Сообщения».</div>` : '';
                container.innerHTML = `
                    <h2 class="section-title"><i data-lucide="calendar-days"></i> Расписание: ${escapeHtml(data.employee.full_name)}</h2>
                    <div class="stage-hint">
                        План «${escapeHtml(data.plan_title)}» · дата выхода ${escapeHtml(data.start_date)} ·
                        сообщений: ${(data.messages || []).length}
                    </div>
                    ${notGenerated}
                    <div class="export-links">
                        <a href="${base}/schedule.md" download><i data-lucide="download"></i> schedule.md</a>
                        <a href="${base}/schedule.json" download><i data-lucide="download"></i> schedule.json</a>
                    </div>
                    <table class="schedule">
                        <thead><tr><th>Этап</th><th>Подэтап</th><th>Дата и время</th><th>Сообщение</th></tr></thead>
                        <tbody>${messageRows(data.messages, false)}</tbody>
                    </table>
                `;
                container.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }

        // ==================== Вопросы без ответа ====================
        function reasonLabel(r) {
            return r === 'escalate'
                ? '<span class="badge escalate"><i data-lucide="triangle-alert"></i> ЧС</span>'
                : '<span class="badge"><i data-lucide="search-x"></i> нет ответа</span>';
        }

        function updateQuestionsBadge(count) {
            const badge = document.getElementById('questions-badge');
            if (count > 0) { badge.textContent = count; badge.style.display = 'inline-block'; }
            else { badge.style.display = 'none'; }
        }

        function loadQuestions() {
            const showAll = document.getElementById('questions-show-all').checked;
            const url = showAll ? '/questions?status=' : '/questions?status=open';
            api(url).then(r => r.json()).then(d => {
                updateQuestionsBadge(d.open_count || 0);
                renderQuestions(d.questions || []);
            }).catch(() => {});
        }

        function refreshQuestionsBadge() {
            api('/questions?status=open').then(r => r.json())
                .then(d => updateQuestionsBadge(d.open_count || 0)).catch(() => {});
        }

        function renderQuestions(items) {
            const box = document.getElementById('questions-list');
            if (!items.length) {
                box.innerHTML = '<div class="empty-hint">Открытых вопросов нет <i data-lucide="party-popper"></i></div>';
                return;
            }
            box.innerHTML = items.map(q => {
                const who = [escapeHtml(q.user_name), escapeHtml(q.position)].filter(Boolean).join(', ');
                const contact = q.contact ? ` · ${escapeHtml(q.contact)}` : '';
                const resolved = q.resolved_question && q.resolved_question !== q.question
                    ? `<div class="context-note"><i data-lucide="link-2"></i> Понято как: «${escapeHtml(q.resolved_question)}»</div>` : '';
                if (q.status === 'resolved') {
                    return `<div class="card" style="opacity:.75;">
                        <div>${reasonLabel(q.reason)} <small style="color:#94a3b8;">${escapeHtml(q.created_at)}</small></div>
                        <div style="margin:6px 0;"><strong><i data-lucide="help-circle"></i> ${escapeHtml(q.question)}</strong> — ${who}${contact}</div>
                        <div class="answer"><i data-lucide="check"></i> ${escapeHtml(q.answer)}</div>
                        <small style="color:#94a3b8;">Ответил: ${escapeHtml(q.answered_by || '')} · ${escapeHtml(q.answered_at || '')}</small>
                    </div>`;
                }
                return `<div class="card">
                    <div>${reasonLabel(q.reason)} <small style="color:#94a3b8;">${escapeHtml(q.created_at)}</small></div>
                    <div style="margin:6px 0;"><strong><i data-lucide="help-circle"></i> ${escapeHtml(q.question)}</strong></div>
                    <div style="font-size:13px;color:#475569;">От: ${who}${contact}${q.mentor ? ' · наставник: ' + escapeHtml(q.mentor) : ''}</div>
                    ${resolved}
                    <textarea id="ans-${q.id}" rows="3" style="width:100%;margin-top:8px;" placeholder="Ответ сотруднику (можно после консультации со специалистом)"></textarea>
                    <button class="primary-btn" style="margin-top:6px;" onclick="resolveQuestion('${q.id}')"><i data-lucide="send-horizontal"></i> Отправить ответ</button>
                </div>`;
            }).join('');
            refreshIcons();
        }

        function resolveQuestion(qid) {
            const answer = (document.getElementById('ans-' + qid).value || '').trim();
            if (!answer) { alert('Введите ответ'); return; }
            apiJson(`/questions/${encodeURIComponent(qid)}/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answer }),
            }).then(({ ok, data }) => {
                if (!ok) { alert(data.detail || 'Не удалось сохранить ответ'); return; }
                loadQuestions();
            });
        }

        refreshQuestionsBadge();
        ensureEmployeesLoaded();

        // ==================== Подсказка «что дальше» (путь: пользователи → документы → планы → сообщения) ====================
        // Одна подсказка на все вкладки: первый незавершённый шаг с кнопкой перехода. Нужна тому,
        // кто видит систему впервые, — без инструкции понятно, что делать следующим.
        function goTab(id) { const t = document.querySelector(`.tab[data-tab="${id}"]`); if (t) t.click(); }
        function renderNextStep() {
            api('/plans').then(r => r.ok ? r.json() : { plans: [] }).then(d => {
                const plans = d.plans || [];
                const people = employeesCache.filter(u => u.role === 'employee');
                const docsReady = docsCache.filter(x => x.status === 'indexed').length;
                let step = null;
                if (!people.length) step = ['employees', 'Шаг 1 из 4. Добавьте сотрудников: загрузите штатное расписание или добавьте человека вручную.'];
                else if (!docsCache.length) step = ['docs', 'Шаг 2 из 4. Загрузите документы компании (регламенты, инструкции) — по ним ИИ напишет сообщения и будет отвечать на вопросы.'];
                else if (!plans.length) step = ['builder', 'Шаг 3 из 4. Создайте план адаптации: этапы и подэтапы с датами отправки.'];
                else if (docsReady && !plans.some(p => p.generated)) step = ['plantexts', 'Шаг 4 из 4. Сгенерируйте сообщения плана — кнопка «Обновить сообщения плана».'];
                else if (people.some(u => !u.plan_id || !u.start_date)) step = ['employees', 'Осталось: назначьте сотрудникам план и дату выхода (кнопка «Изменить» у сотрудника) — с даты выхода начнут приходить сообщения.'];
                document.querySelectorAll('.next-step').forEach(el => {
                    const pane = el.closest('.tab-pane');
                    const here = step && pane && pane.id === `pane-${step[0]}`;
                    el.innerHTML = step ? `<i data-lucide="footprints"></i> <span>${escapeHtml(step[1])}</span>`
                        + (here ? '' : ` <button class="ghost-btn" onclick="goTab('${step[0]}')">Перейти →</button>`) : '';
                    el.style.display = step ? '' : 'none';
                });
                refreshIcons();
            }).catch(() => {});
        }
