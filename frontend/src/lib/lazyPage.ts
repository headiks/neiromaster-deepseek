// Страницы, которые грузятся по требованию. Через VPN или слабую сеть загрузка куска сайта
// может оборваться — тогда React.lazy запоминает ошибку, и раздел не открывается до
// перезагрузки вкладки. Здесь: повтор с паузой, общий промис для предзагрузки
// (переход по меню открывает страницу сразу) и признак «кусок сайта не загрузился».
import { lazy, type ComponentType } from 'react';

type Loader = () => Promise<{ default: ComponentType }>;
export type LazyPage = ComponentType & { preload: () => Promise<unknown> };

const RETRY_DELAYS = [600, 1500, 3000];

/** Адрес файла из ошибки import() (Chrome, Firefox пишут его в сообщении). */
function chunkUrl(error: unknown): string | null {
  const m = String((error as Error)?.message ?? '').match(/(https?:\/\/\S+?\.js)/);
  return m ? m[1] : null;
}

function withRetry(load: Loader): Loader {
  return async () => {
    let next = load;
    for (let attempt = 0; ; attempt++) {
      try {
        return await next();
      } catch (e) {
        if (attempt >= RETRY_DELAYS.length) throw e;
        await new Promise((r) => window.setTimeout(r, RETRY_DELAYS[attempt]));
        // Браузер запоминает неудачный import() по адресу, и повтор по тому же адресу
        // падает сразу, без запроса. Поэтому повторяем с меткой в адресе.
        const url = chunkUrl(e);
        if (url) next = () => import(/* @vite-ignore */ `${url.split('?')[0]}?retry=${Date.now()}`);
      }
    }
  };
}

export function lazyPage(load: Loader): LazyPage {
  let promise: ReturnType<Loader> | null = null;
  const once = () => {
    // Неудачу не кэшируем: следующий заход (или предзагрузка) попробует снова.
    promise ??= withRetry(load)().catch((e) => { promise = null; throw e; });
    return promise;
  };
  const Page = lazy(once) as unknown as LazyPage;
  Page.preload = () => once().catch(() => undefined);
  return Page;
}

/** Предзагрузка в простое браузера — чтобы переход по меню не ждал сеть. */
export function preloadWhenIdle(pages: LazyPage[]) {
  const run = () => pages.reduce((p, page) => p.then(() => page.preload()), Promise.resolve() as Promise<unknown>);
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(run, { timeout: 3000 });
  else window.setTimeout(run, 1200);
}

export function isChunkError(error: unknown): boolean {
  const text = String((error as Error)?.message ?? error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Unable to preload/i.test(text);
}
