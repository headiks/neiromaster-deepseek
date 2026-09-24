// Ошибка при показе страницы: вместо белого экрана — понятное сообщение и кнопка
// «Обновить». Если не загрузился кусок сайта (сеть/VPN), вкладка один раз обновляется сама.
import { Component, type ReactNode } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { isChunkError } from '../lib/lazyPage';
import { Button, Empty } from './index';

const RELOAD_KEY = 'nm_chunk_reload';

function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 30000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

type Props = { children: ReactNode };
type State = { error: unknown };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (isChunkError(error)) reloadOnce();
    else console.error(error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const network = isChunkError(error);
    return (
      <Empty
        icon={network ? WifiOff : undefined}
        action={<Button variant="primary" icon={RefreshCw} onClick={() => window.location.reload()}>Обновить страницу</Button>}
      >
        {network
          ? 'Не удалось загрузить страницу: связь с сервером прервалась. Проверьте интернет и обновите страницу.'
          : 'На странице произошла ошибка. Обновите страницу — если не поможет, сообщите администратору.'}
      </Empty>
    );
  }
}
