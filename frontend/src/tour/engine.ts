/*
 * Интерактивный тур «Как пользоваться»: сайт сам проходит по разделам — подсвечивает
 * элемент, подводит к нему курсор, «нажимает», печатает пример в поле и объясняет, зачем
 * это нужно. Слой поверх страницы на чистом DOM: не зависит от того, как отрисованы экраны.
 *
 * Безопасность прохода: тур ничего не сохраняет и не отправляет на сервер. Открытые демо-окна
 * закрываются, напечатанное в полях стирается, раздел и прокрутка возвращаются как были.
 *
 * Управление: автопросмотр (по умолчанию), пауза, назад/далее, Esc — выход, ← → — шаги,
 * пробел — пауза.
 */

export type Kit = {
  sleep: (ms: number) => Promise<void>;
  find: (sel: Selector) => HTMLElement | null;
  waitFor: (sel: Selector, timeout?: number) => Promise<HTMLElement | null>;
  type: (sel: Selector, text: string, speed?: number) => Promise<void>;
  clearTyped: () => void;
};

export type Selector = string | (() => Element | null);

export type Step = {
  chapter?: string;
  title: string;
  text?: string;
  html?: string;
  target?: Selector;
  click?: boolean;
  final?: boolean;
  duration?: number;
  buttons?: { act: string; label: string; primary?: boolean }[];
  enter?: (k: Kit) => unknown;
  act?: (k: Kit) => unknown;
  leave?: (k: Kit) => unknown;
};

export type Scenario = {
  id: string;
  offer: string;
  steps: () => Step[];
  snapshot?: () => unknown;
  restore?: (snap: unknown) => void;
  actions?: Record<string, () => void>;
};

const SEEN_KEY = 'nm_tour_seen_';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

function visible(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function find(sel: Selector): HTMLElement | null {
  if (!sel) return null;
  const list = typeof sel === 'function' ? [sel()] : Array.from(document.querySelectorAll(sel));
  return (list.find((el) => visible(el)) as HTMLElement | undefined) || null;
}

async function waitFor(sel: Selector, timeout = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const el = find(sel);
    if (el) return el;
    await sleep(120);
  }
  return null;
}

// Значение поля без события input: React-состояние не меняется, после тура поле вернётся.
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
}

const S = {
  steps: [] as Step[], i: -1, playing: true, running: false, token: 0,
  elapsed: 0, duration: 0, lastTick: 0, raf: 0, target: null as HTMLElement | null,
  snapshot: null as unknown, scenario: null as Scenario | null,
  typed: [] as { el: HTMLInputElement | HTMLTextAreaElement; value: string }[],
};
let root: HTMLDivElement, spot: HTMLDivElement, card: HTMLDivElement, cursor: SVGSVGElement, blocker: HTMLDivElement;
const listeners = new Set<(running: boolean) => void>();

function notify() { listeners.forEach((l) => l(S.running)); }
export function onTourChange(l: (running: boolean) => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export const tourRunning = () => S.running;

function build() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'nmt-root';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Как пользоваться');
  root.setAttribute('data-nolog', '');
  root.innerHTML = `
    <div class="nmt-blocker"></div>
    <div class="nmt-spot nmt-none"></div>
    <svg class="nmt-cursor nmt-hidden" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 2.5 19.5 12 12.4 13.6 9.2 20.5z" class="nmt-cursor-path" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>
    <div class="nmt-card" tabindex="-1" aria-live="polite">
      <div class="nmt-chapter"><span class="nmt-chap"></span><span class="nmt-count"></span></div>
      <div class="nmt-title"></div>
      <div class="nmt-text"></div>
      <div class="nmt-progress"><div></div></div>
      <div class="nmt-controls">
        <button class="nmt-btn nmt-icon" data-act="prev" title="Назад (←)" aria-label="Назад">←</button>
        <button class="nmt-btn" data-act="play" title="Пауза / продолжить (пробел)"></button>
        <span class="nmt-spacer"></span>
        <button class="nmt-btn" data-act="close" title="Закончить (Esc)"><span class="nmt-label">Закончить</span><span aria-hidden="true"> ✕</span></button>
        <button class="nmt-btn nmt-primary" data-act="next" title="Далее (→)">Далее →</button>
      </div>
      <div class="nmt-dots"></div>
    </div>`;
  document.body.appendChild(root);
  spot = root.querySelector('.nmt-spot')!;
  card = root.querySelector('.nmt-card')!;
  cursor = root.querySelector('.nmt-cursor')!;
  blocker = root.querySelector('.nmt-blocker')!;
  root.addEventListener('click', (e) => {
    const act = (e.target as Element).closest<HTMLButtonElement>('[data-act]');
    if (!act || act.disabled) return;
    const a = act.dataset.act!;
    const base: Record<string, () => void> = { prev, next, play: togglePlay, close: () => { stop(true); }, again: restart };
    (base[a] || S.scenario?.actions?.[a] || (() => {}))();
  });
  blocker.addEventListener('click', () => { if (S.playing) togglePlay(); });
  document.addEventListener('keydown', (e) => {
    if (!S.running) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(true); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if (e.key === ' ' && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName || '')) {
      e.preventDefault(); togglePlay();
    }
  }, true);
  window.addEventListener('resize', () => S.running && place(S.target));
  window.addEventListener('scroll', () => S.running && place(S.target, true), true);
}

function place(target: HTMLElement | null, quiet = false) {
  const pad = 6;
  const shown = target && visible(target);
  if (shown) {
    const r = target!.getBoundingClientRect();
    spot.classList.remove('nmt-none');
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  } else {
    spot.classList.add('nmt-none');
  }
  if (!quiet) card.classList.add('nmt-in');
  if (window.innerWidth <= 640) {
    // Телефон: карточка — шторка снизу; элемент внизу экрана — шторка сверху.
    const r = shown ? target!.getBoundingClientRect() : null;
    card.classList.toggle('nmt-top', !!r && (r.top + r.height / 2) > window.innerHeight * 0.5);
    return;
  }
  const cw = card.offsetWidth, ch = card.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  let left = (vw - cw) / 2, top = (vh - ch) / 2;
  if (shown) {
    const r = target!.getBoundingClientRect();
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

function moveCursor(target: HTMLElement | null) {
  if (!target || !visible(target)) { cursor.classList.add('nmt-hidden'); return Promise.resolve(); }
  const r = target.getBoundingClientRect();
  cursor.classList.remove('nmt-hidden');
  cursor.style.left = `${r.left + Math.min(r.width * 0.5, 60)}px`;
  cursor.style.top = `${r.top + Math.min(r.height * 0.6, 24)}px`;
  return sleep(750);
}

async function clickEffect() {
  cursor.classList.remove('nmt-click');
  void cursor.getBoundingClientRect();      // перезапуск анимации
  cursor.classList.add('nmt-click');
  await sleep(350);
}

const kit: Kit = {
  sleep, find, waitFor,
  async type(sel, text, speed = 45) {
    const el = (await waitFor(sel)) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el || !('value' in el)) return;
    if (!S.typed.some((t) => t.el === el)) S.typed.push({ el, value: el.value });
    el.focus({ preventScroll: true });
    setNativeValue(el, '');
    for (const ch of text) {
      if (!S.running) return;
      setNativeValue(el, el.value + ch);
      await sleep(speed);
    }
  },
  clearTyped() {
    S.typed.forEach((t) => setNativeValue(t.el, t.value));
    S.typed = [];
  },
};

function renderCard(step: Step) {
  const n = S.steps.length;
  card.querySelector('.nmt-chap')!.textContent = step.chapter || '';
  card.querySelector('.nmt-count')!.textContent = step.final ? '' : `${S.i + 1} из ${n}`;
  card.querySelector('.nmt-title')!.textContent = step.title || '';
  card.querySelector('.nmt-text')!.innerHTML = step.html || esc(step.text || '');
  (card.querySelector('[data-act="prev"]') as HTMLButtonElement).disabled = S.i === 0;
  card.querySelector('[data-act="next"]')!.textContent = S.i === n - 1 ? 'Готово ✓' : 'Далее →';
  card.querySelector('.nmt-dots')!.innerHTML = S.steps.map((_, k) =>
    `<span class="${k < S.i ? 'nmt-done' : k === S.i ? 'nmt-cur' : ''}"></span>`).join('');
  card.querySelector('.nmt-extra')?.remove();
  if (step.buttons) {
    const box = document.createElement('div');
    box.className = 'nmt-controls nmt-extra';
    box.innerHTML = step.buttons.map((b) =>
      `<button class="nmt-btn ${b.primary ? 'nmt-primary' : ''}" data-act="${esc(b.act)}">${esc(b.label)}</button>`).join('');
    card.querySelector('.nmt-dots')!.before(box);
  }
  updatePlayButton();
}

function stepDuration(step: Step) {
  if (step.final) return Infinity;           // финал ждёт решения человека
  const len = (step.text || step.html || '').replace(/<[^>]+>/g, '').length;
  return step.duration || Math.min(14000, 3200 + len * 42);
}

async function show(index: number) {
  if (index < 0 || index >= S.steps.length) return;
  const token = ++S.token;
  S.lastTick = 0;                            // таймер шага стоит, пока шаг готовится
  const prevStep = S.steps[S.i];
  if (prevStep?.leave) { try { await prevStep.leave(kit); } catch { /* шаг не критичен */ } }
  if (token !== S.token) return;
  S.i = index;
  const step = S.steps[index];
  card.classList.remove('nmt-in');
  S.elapsed = 0;
  S.duration = stepDuration(step);
  setProgress(0);
  try { if (step.enter) await step.enter(kit); } catch { /* элемента нет — покажем по центру */ }
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
    try { await step.act(kit); } catch { /* демонстрация не должна ронять тур */ }
    if (token !== S.token) return;
    target = step.target ? find(step.target) : null;
    S.target = target;
    place(target, true);
  }
  S.lastTick = performance.now();
}

function setProgress(frac: number) {
  const bar = card?.querySelector<HTMLDivElement>('.nmt-progress > div');
  if (bar) bar.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
}

function tick(now: number) {
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
  const b = card.querySelector<HTMLButtonElement>('[data-act="play"]')!;
  b.style.display = S.steps[S.i]?.final ? 'none' : '';
  b.innerHTML = S.playing ? '❚❚ <span class="nmt-label">Пауза</span>' : '▶ <span class="nmt-label">Автопросмотр</span>';
}
function togglePlay() { S.playing = !S.playing; updatePlayButton(); }
function next() { if (S.i >= S.steps.length - 1) stop(true); else show(S.i + 1); }
function prev() { if (S.i > 0) show(S.i - 1); }
function restart() { S.playing = true; show(0); }

export async function start(scenario: Scenario, opts: { autoplay?: boolean } = {}) {
  if (S.running) return;
  build();
  dismissOffer();
  S.scenario = scenario;
  S.steps = scenario.steps();
  S.i = -1;
  S.playing = opts.autoplay !== false;
  S.running = true;
  S.typed = [];
  try { S.snapshot = scenario.snapshot ? scenario.snapshot() : null; } catch { S.snapshot = null; }
  root.hidden = false;
  document.documentElement.classList.add('nmt-active');
  notify();
  cancelAnimationFrame(S.raf);
  S.raf = requestAnimationFrame(tick);
  await show(0);
  card.focus({ preventScroll: true });
}

export async function stop(markSeen = false) {
  if (!S.running) return;
  S.token++;
  const step = S.steps[S.i];
  if (step?.leave) { try { await step.leave(kit); } catch { /* ignore */ } }
  S.running = false;
  cancelAnimationFrame(S.raf);
  kit.clearTyped();
  try { S.scenario?.restore?.(S.snapshot); } catch { /* ignore */ }
  root.hidden = true;
  card.classList.remove('nmt-in');
  cursor.classList.add('nmt-hidden');
  document.documentElement.classList.remove('nmt-active');
  if (markSeen && S.scenario) store.set(SEEN_KEY + S.scenario.id, '1');
  notify();
}

// ---------- Предложение пройти тур при первом входе ----------
let offer: HTMLDivElement | null = null;
export function dismissOffer() { offer?.remove(); offer = null; }

export function maybeOffer(scenario: Scenario) {
  if (offer || S.running || store.get(SEEN_KEY + scenario.id)) return;
  offer = document.createElement('div');
  offer.className = 'nmt-offer';
  offer.setAttribute('role', 'dialog');
  offer.setAttribute('aria-label', 'Впервые здесь?');
  offer.innerHTML = `<b>Впервые здесь?</b>
    <p>${esc(scenario.offer)}</p>
    <div class="nmt-controls">
      <button class="nmt-btn" data-o="later">Не сейчас</button>
      <button class="nmt-btn nmt-primary" data-o="go">Показать</button>
    </div>`;
  offer.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-o]');
    if (!b) return;
    store.set(SEEN_KEY + scenario.id, '1');
    dismissOffer();
    if (b.dataset.o === 'go') start(scenario);
  });
  document.body.appendChild(offer);
}
