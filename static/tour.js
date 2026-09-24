/*
 * Интерактивный тур «Как пользоваться» — сайт сам проходит по разделам и показывает,
 * что где нажимать: подсвечивает элемент, подводит к нему курсор, «нажимает», печатает
 * пример в поле и объясняет, зачем это нужно. Работает в админке (/admin) и в кабинете
 * сотрудника (/), сценарий выбирается по <body data-tour="admin|cabinet">.
 *
 * Безопасность прохода: тур ничего не сохраняет и не отправляет на сервер. Открытые окна
 * закрываются, напечатанное в полях стирается, вкладка, прокрутка и редактируемый план
 * возвращаются в исходное состояние (снимок до старта).
 *
 * Управление: автопросмотр (по умолчанию), пауза, назад/далее, Esc — выход,
 * ← → — шаги, пробел — пауза. Старт: кнопка «Как пользоваться» или ?tour=1 в адресе.
 */
(function () {
    'use strict';

    const SEEN_KEY = 'nm_tour_seen_';
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } },
    };

    // ------------------------------------------------------------------ элементы
    function visible(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    }
    function find(sel) {
        if (!sel) return null;
        const list = typeof sel === 'function' ? [sel()] : [...document.querySelectorAll(sel)];
        return list.find(visible) || null;
    }
    async function waitFor(sel, timeout = 2500) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeout) {
            const el = find(sel);
            if (el) return el;
            await sleep(120);
        }
        return null;
    }

    // ------------------------------------------------------------------ состояние
    const S = {
        steps: [], i: -1, playing: true, running: false, token: 0,
        elapsed: 0, duration: 0, lastTick: 0, raf: 0, target: null,
        snapshot: null, scenario: null, typed: [],
    };
    let root, spot, card, cursor, blocker;

    function build() {
        if (root) return;
        root = document.createElement('div');
        root.className = 'nmt-root';
        root.hidden = true;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-live', 'polite');
        root.innerHTML = `
            <div class="nmt-blocker"></div>
            <div class="nmt-spot nmt-none"></div>
            <svg class="nmt-cursor nmt-hidden" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 2.5 19.5 12 12.4 13.6 9.2 20.5z" fill="#fff" stroke="#1d1f20" stroke-width="1.4" stroke-linejoin="round"/>
            </svg>
            <div class="nmt-card" tabindex="-1">
                <div class="nmt-chapter"><span class="nmt-chap"></span><span class="nmt-count"></span></div>
                <div class="nmt-title"></div>
                <div class="nmt-text"></div>
                <div class="nmt-progress"><div></div></div>
                <div class="nmt-controls">
                    <button class="nmt-btn nmt-icon" data-act="prev" title="Назад (←)">←</button>
                    <button class="nmt-btn" data-act="play" title="Пауза / продолжить (пробел)"></button>
                    <span class="nmt-spacer"></span>
                    <button class="nmt-btn" data-act="close" title="Закончить (Esc)"><span class="nmt-label">Закончить</span><span aria-hidden="true"> ✕</span></button>
                    <button class="nmt-btn nmt-primary" data-act="next" title="Далее (→)">Далее →</button>
                </div>
                <div class="nmt-dots"></div>
            </div>`;
        document.body.appendChild(root);
        spot = root.querySelector('.nmt-spot');
        card = root.querySelector('.nmt-card');
        cursor = root.querySelector('.nmt-cursor');
        blocker = root.querySelector('.nmt-blocker');
        root.addEventListener('click', e => {
            const act = e.target.closest('[data-act]');
            if (!act || act.disabled) return;
            ({ prev, next, play: togglePlay, close: () => stop(true), again: restart,
               cabinet: () => { location.href = '/?tour=1'; } })[act.dataset.act]();
        });
        blocker.addEventListener('click', () => { if (S.playing) togglePlay(); });
        document.addEventListener('keydown', e => {
            if (!S.running) return;
            if (e.key === 'Escape') { e.preventDefault(); stop(true); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
            else if (e.key === ' ' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
                e.preventDefault(); togglePlay();
            }
        }, true);
        window.addEventListener('resize', () => S.running && place(S.target));
        window.addEventListener('scroll', () => S.running && place(S.target, true), true);
    }

    // ------------------------------------------------------------------ раскладка
    function place(target, quiet) {
        const pad = 6;
        if (target && visible(target)) {
            const r = target.getBoundingClientRect();
            spot.classList.remove('nmt-none');
            spot.style.left = `${r.left - pad}px`;
            spot.style.top = `${r.top - pad}px`;
            spot.style.width = `${r.width + pad * 2}px`;
            spot.style.height = `${r.height + pad * 2}px`;
        } else {
            spot.classList.add('nmt-none');
        }
        if (!quiet) card.classList.add('nmt-in');
        if (window.innerWidth <= 640) {
            // Телефон: карточка — шторка снизу; если элемент внизу экрана — шторка сверху,
            // чтобы не закрывать то, о чём рассказываем.
            const r = target && visible(target) ? target.getBoundingClientRect() : null;
            card.classList.toggle('nmt-top', !!r && (r.top + r.height / 2) > window.innerHeight * 0.5);
            return;
        }
        const cw = card.offsetWidth, ch = card.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
        let left = (vw - cw) / 2, top = (vh - ch) / 2;
        if (target && visible(target)) {
            const r = target.getBoundingClientRect();
            const gap = 16;
            if (r.bottom + gap + ch < vh) { top = r.bottom + gap; left = r.left; }
            else if (r.top - gap - ch > 0) { top = r.top - gap - ch; left = r.left; }
            else if (r.right + gap + cw < vw) { left = r.right + gap; top = r.top; }
            else if (r.left - gap - cw > 0) { left = r.left - gap - cw; top = r.top; }
            else { top = vh - ch - 16; }
        }
        card.style.left = `${Math.max(12, Math.min(left, vw - cw - 12))}px`;
        card.style.top = `${Math.max(12, Math.min(top, vh - ch - 12))}px`;
    }

    function moveCursor(target) {
        if (!target || !visible(target)) { cursor.classList.add('nmt-hidden'); return Promise.resolve(); }
        const r = target.getBoundingClientRect();
        cursor.classList.remove('nmt-hidden');
        cursor.style.left = `${r.left + Math.min(r.width * 0.5, 60)}px`;
        cursor.style.top = `${r.top + Math.min(r.height * 0.6, 24)}px`;
        return sleep(750);
    }
    async function clickEffect() {
        cursor.classList.remove('nmt-click');
        void cursor.offsetWidth;                      // перезапуск анимации
        cursor.classList.add('nmt-click');
        await sleep(350);
    }

    // ------------------------------------------------------------------ действия шага
    /** Инструменты, которые получает сценарий: всё обратимо (restore() в конце тура). */
    const kit = {
        sleep, find, waitFor,
        /** Печать текста в поле «как человек». Исходное значение вернётся после тура. */
        async type(sel, text, speed = 45) {
            const el = await waitFor(sel);
            if (!el) return;
            if (!S.typed.some(t => t.el === el)) S.typed.push({ el, value: el.value });
            el.focus({ preventScroll: true });
            el.value = '';
            for (const ch of text) {
                if (!S.running) return;
                el.value += ch;
                await sleep(speed);
            }
        },
        async click(sel) {                            // только анимация «нажатия», без клика
            const el = await waitFor(sel);
            if (!el) return null;
            await moveCursor(el);
            await clickEffect();
            return el;
        },
        clearTyped() {
            S.typed.forEach(t => { t.el.value = t.value; });
            S.typed = [];
        },
    };

    // ------------------------------------------------------------------ шаги
    function renderCard(step) {
        const n = S.steps.length;
        card.querySelector('.nmt-chap').textContent = step.chapter || '';
        card.querySelector('.nmt-count').textContent = step.final ? '' : `${S.i + 1} из ${n}`;
        card.querySelector('.nmt-title').textContent = step.title || '';
        card.querySelector('.nmt-text').innerHTML = step.html || esc(step.text || '');
        card.querySelector('[data-act="prev"]').disabled = S.i === 0;
        const nextBtn = card.querySelector('[data-act="next"]');
        nextBtn.textContent = S.i === n - 1 ? 'Готово ✓' : 'Далее →';
        card.querySelector('.nmt-dots').innerHTML = S.steps.map((_, k) =>
            `<span class="${k < S.i ? 'nmt-done' : k === S.i ? 'nmt-cur' : ''}"></span>`).join('');
        const extra = card.querySelector('.nmt-extra');
        if (extra) extra.remove();
        if (step.buttons) {
            const box = document.createElement('div');
            box.className = 'nmt-controls nmt-extra';
            box.style.marginTop = '10px';
            box.innerHTML = step.buttons.map(b =>
                `<button class="nmt-btn ${b.primary ? 'nmt-primary' : ''}" data-act="${esc(b.act)}">${esc(b.label)}</button>`).join('');
            card.querySelector('.nmt-dots').before(box);
        }
        updatePlayButton();
    }

    function stepDuration(step) {
        if (step.final) return Infinity;              // финал ждёт решения человека
        const len = (step.text || step.html || '').replace(/<[^>]+>/g, '').length;
        return step.duration || Math.min(14000, 3200 + len * 42);
    }

    async function show(index) {
        if (index < 0 || index >= S.steps.length) return;
        const token = ++S.token;
        S.lastTick = 0;                               // таймер шага стоит, пока шаг готовится
        const prevStep = S.steps[S.i];
        if (prevStep && prevStep.leave) { try { await prevStep.leave(kit); } catch (e) { /* шаг не критичен */ } }
        if (token !== S.token) return;
        S.i = index;
        const step = S.steps[index];
        card.classList.remove('nmt-in');
        S.elapsed = 0;
        S.duration = stepDuration(step);
        setProgress(0);
        try { if (step.enter) await step.enter(kit); } catch (e) { /* элемента нет — покажем по центру */ }
        if (token !== S.token) return;
        let target = step.target ? await waitFor(step.target, 2000) : null;
        if (token !== S.token) return;
        if (target) {
            target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
            await sleep(380);
        }
        renderCard(step);
        place(target);
        S.target = target;
        if (target && step.click) {
            await moveCursor(target);
            if (token !== S.token) return;
            await clickEffect();
        } else if (target) {
            moveCursor(target);
        } else {
            cursor.classList.add('nmt-hidden');
        }
        if (token !== S.token) return;
        if (step.act) {
            try { await step.act(kit); } catch (e) { /* демонстрация не должна ронять тур */ }
            if (token !== S.token) return;
            target = step.target ? find(step.target) : null;
            S.target = target;
            place(target, true);
        }
        S.lastTick = performance.now();
    }

    function setProgress(frac) {
        const bar = card && card.querySelector('.nmt-progress > div');
        if (bar) bar.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    }

    function tick(now) {
        if (!S.running) return;
        if (S.playing && S.lastTick) {
            S.elapsed += now - S.lastTick;
            if (Number.isFinite(S.duration)) {
                setProgress(S.elapsed / S.duration);
                if (S.elapsed >= S.duration) {
                    S.lastTick = 0;
                    if (S.i < S.steps.length - 1) show(S.i + 1);
                }
            }
        }
        if (S.lastTick) S.lastTick = now;
        S.raf = requestAnimationFrame(tick);
    }

    function updatePlayButton() {
        const b = card.querySelector('[data-act="play"]');
        const final = (S.steps[S.i] || {}).final;
        b.style.display = final ? 'none' : '';
        b.innerHTML = S.playing ? '❚❚ <span class="nmt-label">Пауза</span>' : '▶ <span class="nmt-label">Автопросмотр</span>';
    }
    function togglePlay() { S.playing = !S.playing; updatePlayButton(); }
    function next() { if (S.i >= S.steps.length - 1) stop(true); else show(S.i + 1); }
    function prev() { if (S.i > 0) show(S.i - 1); }
    function restart() { S.playing = true; show(0); }

    // ------------------------------------------------------------------ старт/стоп
    async function start(opts = {}) {
        const scenario = SCENARIOS[document.body.dataset.tour];
        if (!scenario || S.running) return;
        build();
        dismissOffer();
        S.scenario = scenario;
        S.steps = scenario.steps();
        S.i = -1;
        S.playing = opts.autoplay !== false;
        S.running = true;
        S.typed = [];
        try { S.snapshot = scenario.snapshot ? scenario.snapshot() : null; } catch (e) { S.snapshot = null; }
        root.hidden = false;
        document.documentElement.classList.add('nmt-active');
        cancelAnimationFrame(S.raf);
        S.raf = requestAnimationFrame(tick);
        await show(0);
        card.focus({ preventScroll: true });
    }

    async function stop(markSeen) {
        if (!S.running) return;
        S.token++;
        const step = S.steps[S.i];
        if (step && step.leave) { try { await step.leave(kit); } catch (e) { /* ignore */ } }
        S.running = false;
        cancelAnimationFrame(S.raf);
        kit.clearTyped();
        try { if (S.scenario && S.scenario.restore) S.scenario.restore(S.snapshot); } catch (e) { /* ignore */ }
        root.hidden = true;
        card.classList.remove('nmt-in');
        cursor.classList.add('nmt-hidden');
        document.documentElement.classList.remove('nmt-active');
        if (markSeen) store.set(SEEN_KEY + document.body.dataset.tour, '1');
    }

    // ------------------------------------------------------------------ предложение при первом входе
    let offer = null;
    function dismissOffer() { if (offer) { offer.remove(); offer = null; } }
    function maybeOffer() {
        const page = document.body.dataset.tour;
        if (!SCENARIOS[page] || store.get(SEEN_KEY + page)) return;
        offer = document.createElement('div');
        offer.className = 'nmt-offer';
        offer.innerHTML = `<b>Впервые здесь?</b>
            <p>${esc(SCENARIOS[page].offer)}</p>
            <div class="nmt-controls">
                <button class="nmt-btn" data-o="later">Не сейчас</button>
                <button class="nmt-btn nmt-primary" data-o="go">Показать</button>
            </div>`;
        offer.addEventListener('click', e => {
            const b = e.target.closest('[data-o]');
            if (!b) return;
            store.set(SEEN_KEY + page, '1');
            dismissOffer();
            if (b.dataset.o === 'go') start();
        });
        document.body.appendChild(offer);
    }

    // ================================================================== сценарии
    // Каждый шаг сам приводит страницу в нужное состояние (ui/cab в enter): шаги можно
    // листать в любом порядке и быстро — не зависим от того, успел ли отработать прошлый.
    const A = () => window.NMAdminTour || {};
    async function ui(k, { tab = 'employees', dialog = false, staffing = false, demo = false } = {}) {
        const a = A();
        if (a.activeTab && a.activeTab() !== tab) a.goTab(tab);
        if (!dialog) a.closeEmployeeDemo && a.closeEmployeeDemo();
        a.setStaffingOpen && a.setStaffingOpen(staffing);
        if (tab === 'builder') {
            await k.waitFor(() => (a.builderReady && a.builderReady() ? document.body : null), 4000);
            if (demo && !a.demoActive()) a.showDemoPlan();
        }
        if (dialog && !a.dialogOpen()) { a.openEmployeeDemo(); await k.sleep(200); }
    }

    const ADMIN = {
        offer: 'Покажем за пару минут, как устроена админка: сайт сам пройдёт по всем разделам в порядке работы.',
        snapshot: () => A().snapshot && A().snapshot(),
        restore: snap => A().restore && A().restore(snap),
        steps: () => [
            { chapter: 'Знакомство', title: 'Как устроена админка',
              text: 'Работа идёт слева направо по вкладкам: 1 — люди, 2 — план адаптации, 3 — документы компании, 4 — сообщения сотрудникам. Сайт сам пройдёт по всем шагам — можно поставить на паузу или листать стрелками.',
              target: '.tabs', enter: k => ui(k) },
            { chapter: 'Знакомство', title: 'Подсказка «что дальше»',
              text: 'Жёлтая плашка всегда говорит, какой следующий шаг не сделан, и ведёт на нужную вкладку. Если не знаете, что делать, — смотрите на неё.',
              target: '#next-step-employees', enter: k => ui(k) },

            // ---- 1. Пользователи
            { chapter: 'Шаг 1 · Пользователи', title: 'Раздел «Пользователи системы»',
              text: 'Здесь все, кто работает в системе: сотрудники на адаптации, наставники и администраторы. Начинают с него.',
              target: '.tab[data-tab="employees"]', click: true, enter: k => ui(k) },
            { chapter: 'Шаг 1 · Пользователи', title: 'Загрузка штатного расписания',
              text: 'Самый быстрый способ завести людей — загрузить штатку (xlsx, xls или csv). ИИ сам найдёт ФИО, должности и подразделения, покажет таблицу для проверки, а уже заведённых пропустит.',
              target: '#btn-staffing', click: true, enter: k => ui(k), act: () => A().setStaffingOpen(true) },
            { chapter: 'Шаг 1 · Пользователи', title: 'Перетащите файл сюда',
              text: 'После нажатия «Создать» автоматически скачается Excel с логинами и временными паролями — его раздают сотрудникам. Пароль меняет только администратор.',
              target: '#staffing-dropzone', enter: k => ui(k, { staffing: true }) },
            { chapter: 'Шаг 1 · Пользователи', title: 'Или добавьте человека вручную',
              text: 'Кнопка открывает карточку сотрудника. Логин создастся из ФИО, пароль — автоматически.',
              target: '#btn-add-employee', click: true, enter: k => ui(k),
              act: async k => { A().openEmployeeDemo(); await k.sleep(250); } },
            { chapter: 'Шаг 1 · Пользователи', title: 'Карточка сотрудника',
              text: 'Достаточно ФИО. Для адаптации важны три поля: план, дата выхода и наставник — по ним строится расписание сообщений.',
              target: '#emp-full_name', enter: k => ui(k, { dialog: true }),
              act: k => k.type('#emp-full_name', 'Иванов Иван Иванович') },
            { chapter: 'Шаг 1 · Пользователи', title: 'План и дата выхода',
              text: 'Выберите план адаптации и дату выхода на работу. Статус «Запланирован → Проходит адаптацию → Завершил» дальше меняется сам по датам.',
              target: '#emp-plan_id', enter: k => ui(k, { dialog: true }) },
            { chapter: 'Шаг 1 · Пользователи', title: 'Наставник и руководитель',
              text: 'Выбираются из сотрудников. Их имена бот подставит в сообщения, а наставник получит уведомление, если новичок уйдёт на больничный.',
              target: '#emp-mentor', enter: k => ui(k, { dialog: true }), leave: k => k.clearTyped() },
            { chapter: 'Шаг 1 · Пользователи', title: 'Фильтр и доступы',
              text: 'Список можно отфильтровать по подразделению. Кнопка «Логины и пароли (Excel)» выгружает доступы тех, кто ещё не входил в систему.',
              target: '#users-toolbar', enter: k => ui(k) },
            { chapter: 'Шаг 1 · Пользователи', title: 'Действия с сотрудником',
              text: '«Расписание» — что и когда получит человек. «Изменить» — карточка. «Доступ» — новый временный пароль. «Приостановить» — больничный: сообщения ждут возвращения.',
              target: '#employee-list tbody tr td:last-child', enter: k => ui(k) },

            // ---- 2. Планы
            { chapter: 'Шаг 2 · Планы', title: 'Конструктор плана адаптации',
              text: 'План — это расписание: какие сообщения, в какой день и час получит новичок. Сроки считаются от даты выхода, поэтому один план подходит всем.',
              target: '.tab[data-tab="builder"]', click: true, enter: k => ui(k, { tab: 'builder' }) },
            { chapter: 'Шаг 2 · Планы', title: 'С чего начать',
              text: 'Выберите «Стандартный план» — в нём уже есть все этапы адаптации с датами. Или «Создать свой план» с нуля. Сохранённые планы — ниже в этом же списке.',
              target: '#plan-select', click: true, enter: k => ui(k, { tab: 'builder' }),
              act: async k => { if (!A().demoActive()) A().showDemoPlan(); await k.sleep(200); } },
            { chapter: 'Шаг 2 · Планы', title: 'Название плана',
              html: 'Для примера мы открыли <b>демо-план</b> — он не сохранится. Обычно план называют по должности: «Адаптация оператора».',
              target: '#plan-title', enter: k => ui(k, { tab: 'builder', demo: true }),
              act: k => k.type('#plan-title', 'Демо: адаптация оператора', 35) },
            { chapter: 'Шаг 2 · Планы', title: 'Этапы',
              text: 'Этап — период адаптации: «до выхода», «первый день», «первая неделя»… У каждого — длительность и отсчёт: до выхода на работу или от даты выхода.',
              target: '#stages-container .stage-card', enter: k => ui(k, { tab: 'builder', demo: true }) },
            { chapter: 'Шаг 2 · Планы', title: 'Подэтап = одно сообщение',
              text: 'Внутри этапа — сообщения. Тип: обычное сообщение, чек-лист, опрос, мини-тест или напоминание. День и время отправки выбираются здесь же.',
              target: '#stages-container .sub-item', enter: k => ui(k, { tab: 'builder', demo: true }) },
            { chapter: 'Шаг 2 · Планы', title: '«О чём сообщение» — задание для ИИ',
              text: 'Здесь пишут не готовый текст, а что сотрудник должен узнать. Сам текст ИИ напишет по документам компании. Значок «?» рядом с полями объясняет каждое поле.',
              target: '#stages-container .brief-ta', enter: k => ui(k, { tab: 'builder', demo: true }) },
            { chapter: 'Шаг 2 · Планы', title: 'Одна сессия в день',
              text: 'Если сообщений на один день много, их можно присылать вместе — во время первого и одним уведомлением, а не каждые час-два.',
              target: '#plan-group-daily-row', enter: k => ui(k, { tab: 'builder', demo: true }) },
            { chapter: 'Шаг 2 · Планы', title: 'Добавить этап',
              text: 'Этапы берутся из готового каталога или создаются свои — список внизу плана.',
              target: '#add-stage-row', enter: k => ui(k, { tab: 'builder', demo: true }) },
            { chapter: 'Шаг 2 · Планы', title: 'Сохранить план',
              text: 'После сохранения переходите к документам. (В демо мы ничего не сохраняем — ваш план вернётся после тура.)',
              target: '#btn-save-plan', click: true, enter: k => ui(k, { tab: 'builder', demo: true }) },

            // ---- 3. Документы
            { chapter: 'Шаг 3 · Документы', title: 'База знаний',
              text: 'Регламенты, инструкции, положения — всё, по чему ИИ будет писать сообщения и отвечать на вопросы сотрудников.',
              target: '.tab[data-tab="docs"]', click: true, enter: k => ui(k, { tab: 'docs' }) },
            { chapter: 'Шаг 3 · Документы', title: 'Загрузка',
              text: 'Перетащите файлы (PDF, DOCX, PPTX…). ИИ сам разнесёт каждый документ по этапам плана. Одинаковый файл второй раз не обрабатывается; при новой версии система спросит — заменить или сохранить отдельно.',
              target: '#dropzone', click: true, enter: k => ui(k, { tab: 'docs' }) },
            { chapter: 'Шаг 3 · Документы', title: 'Персональные данные и конфиденциальность',
              html: 'Перед отправкой в ИИ из текста автоматически убираются ФИО, телефоны, паспорта, реквизиты — модель их не видит. А документ вроде положения об оплате труда можно отметить <b>«не отправлять в ИИ»</b>: он хранится, но ИИ его не читает.',
              target: '#upload-confidential-row', enter: k => ui(k, { tab: 'docs' }) },
            { chapter: 'Шаг 3 · Документы', title: 'Хватает ли документов',
              text: 'Сводка показывает, сколько документов загружено и сколько подэтапов каждого плана ими обеспечены. Где не хватает — будет ссылка «показать по этапам».',
              target: '#doc-summary', enter: k => ui(k, { tab: 'docs' }) },
            { chapter: 'Шаг 3 · Документы', title: 'Детали по этапам',
              text: 'Под спойлером — какие документы к какому подэтапу отнесены и где пусто. Пустой подэтап = сообщение не сгенерируется, пока не догрузите документ.',
              target: '#stage-details', click: true, enter: k => ui(k, { tab: 'docs' }) },
            { chapter: 'Шаг 3 · Документы', title: 'Список документов',
              text: 'Статус обработки каждого файла, «Посмотреть» — что ИИ нашёл в документе, «Удалить» — убрать его (сообщения по нему обновятся сами).',
              target: '#doc-list', enter: k => ui(k, { tab: 'docs' }) },

            // ---- 4. Сообщения
            { chapter: 'Шаг 4 · Сообщения', title: 'Сообщения сотрудникам',
              text: 'Здесь готовые тексты, которые получат новички по плану.',
              target: '.tab[data-tab="plantexts"]', click: true, enter: k => ui(k, { tab: 'plantexts' }) },
            { chapter: 'Шаг 4 · Сообщения', title: 'План и должность',
              text: 'Выберите план. Сообщения можно подстроить под должность — «Общие» получат все, для кого отдельных нет.',
              target: '#pt-plan', enter: k => ui(k, { tab: 'plantexts' }) },
            { chapter: 'Шаг 4 · Сообщения', title: 'Одна кнопка',
              text: '«Обновить сообщения плана» сначала проверяет, что изменилось, и пишет только недостающее. Перед запуском покажет, сколько запросов к ИИ будет. Если всё актуально — запросов не будет вовсе.',
              target: '#pt-generate-btn', click: true, enter: k => ui(k, { tab: 'plantexts' }) },
            { chapter: 'Шаг 4 · Сообщения', title: 'Правка вручную',
              text: 'У каждого сообщения есть «Редактировать» и «Перегенерировать». Ручную правку автоматическое обновление не затрёт.',
              target: '#pt-body', enter: k => ui(k, { tab: 'plantexts' }) },

            // ---- Вопросы
            { chapter: 'Каждый день', title: 'Вопросы сотрудников',
              text: 'Если ассистент не нашёл ответа в документах или вопрос похож на ЧС, он попадает сюда. Ваш ответ придёт сотруднику в кабинет и пушем. Число открытых вопросов — на вкладке.',
              target: '.tab[data-tab="questions"]', click: true, enter: k => ui(k, { tab: 'questions' }) },
            { chapter: 'Каждый день', title: 'Как видит сотрудник',
              text: '«Страница сотрудника» открывает личный кабинет: чат с сообщениями плана, история и вопросы ассистенту.',
              target: '#btn-employee-page', enter: k => ui(k, { tab: 'questions' }) },
            { chapter: 'Готово', title: 'Вот и всё!',
              html: 'Порядок работы: <b>пользователи → план → документы → сообщения</b>. Тур можно запустить снова кнопкой <b>«Как пользоваться»</b> вверху.',
              target: '#btn-tour', final: true,
              buttons: [{ act: 'again', label: '↺ Ещё раз' }, { act: 'cabinet', label: 'Тур по кабинету сотрудника →', primary: true }] },
        ],
    };

    // ---- кабинет сотрудника
    const cabTab = id => {
        const t = document.querySelector(`.tab[data-tab="${id}"]`);
        if (t && !t.classList.contains('active')) t.click();
    };
    const askView = v => { cabTab('ask'); if (window.setAskView) window.setAskView(v); };
    const CABINET = {
        offer: 'Покажем за минуту, где сообщения по адаптации, как задать вопрос и что делать, если заболели.',
        snapshot() {
            const t = document.querySelector('.tab.active');
            const seg = document.getElementById('seg-questions');
            return { tab: t ? t.dataset.tab : 'today', questions: !!(seg && seg.classList.contains('on')) };
        },
        restore(s) {
            if (!s) return;
            if (window.setAskView) window.setAskView(s.questions ? 'questions' : 'chat');
            cabTab(s.tab);
        },
        steps: () => [
            { chapter: 'Знакомство', title: 'Ваш помощник по адаптации',
              text: 'Здесь приходят сообщения плана адаптации: что сделать до выхода, в первый день и дальше. А ещё можно задать вопрос — ассистент ответит по документам компании.',
              target: '.tabs', enter: () => cabTab('today') },
            { chapter: 'Сообщения', title: 'Чат на сегодня',
              text: 'Сообщения за сегодня. Старые — сверху, новые — снизу. Чек-листы отмечаются нажатием, в тестах выбирается ответ.',
              target: '.tab[data-tab="today"]', click: true, enter: () => cabTab('today') },
            { chapter: 'Сообщения', title: 'Лента сообщений',
              text: 'Всё, что пришло сегодня, собрано здесь. Когда придёт новое, вкладка покажет счётчик непрочитанных.',
              target: '#today-list', enter: () => cabTab('today') },
            { chapter: 'Сообщения', title: 'История',
              text: 'Сообщения прошлых дней, по датам — от старых к новым.',
              target: '.tab[data-tab="history"]', click: true, enter: () => cabTab('history') },
            { chapter: 'Вопросы', title: 'Задать вопрос',
              text: 'Не нашли ответ в сообщениях? Спросите ассистента — про пропуск, спецодежду, график, зарплату.',
              target: '.tab[data-tab="ask"]', click: true,
              enter: () => askView('chat') },
            { chapter: 'Вопросы', title: 'Напишите вопрос своими словами',
              text: 'Например, так. Ответ придёт сразу, если он есть в документах компании.',
              target: '#question-input', enter: () => askView('chat'),
              act: k => k.type('#question-input', 'Где получить спецодежду?', 55) },
            { chapter: 'Вопросы', title: 'Отправить',
              text: 'Если в документах ответа нет или вопрос срочный (травма, пожар), его увидит специалист — ответ придёт в «Мои вопросы». (Сейчас ничего не отправляем.)',
              target: '#ask-btn', click: true, enter: () => askView('chat'), leave: k => k.clearTyped() },
            { chapter: 'Вопросы', title: 'Мои вопросы',
              text: 'Вопросы, переданные специалисту, и ответы на них.',
              target: '#seg-questions', click: true, enter: () => askView('chat'), act: () => askView('questions') },
            { chapter: 'Настройки', title: 'Настройки',
              text: 'Тёмная тема, профиль и выход.',
              target: '.tab[data-tab="settings"]', click: true, enter: () => cabTab('settings') },
            { chapter: 'Настройки', title: 'Заболели? Нажмите «Я на больничном»',
              text: 'Сообщения плана встанут на паузу, а наставник получит уведомление. Выключите после выхода — накопившееся придёт.',
              target: '#card-sick', enter: () => cabTab('settings') },
            { chapter: 'Настройки', title: 'Пароль',
              text: 'Логин и пароль выдаёт администратор. Забыли пароль — обратитесь к нему.',
              target: '#profile', enter: () => cabTab('settings') },
            { chapter: 'Готово', title: 'Готово!',
              html: 'Сообщения — во вкладке <b>«Чат»</b>, вопросы — во вкладке <b>«Вопрос»</b>. Тур можно повторить кнопкой <b>«Как пользоваться»</b>.',
              target: '#btn-tour', final: true, buttons: [{ act: 'again', label: '↺ Ещё раз' }] },
        ],
    };

    const SCENARIOS = { admin: ADMIN, cabinet: CABINET };

    window.NMTour = { start, stop: () => stop(false), running: () => S.running };

    window.addEventListener('load', () => {
        if (/[?&]tour=1\b/.test(location.search)) {
            history.replaceState(null, '', location.pathname);
            setTimeout(() => start(), 600);
        } else {
            setTimeout(maybeOffer, 1500);
        }
    });
})();
