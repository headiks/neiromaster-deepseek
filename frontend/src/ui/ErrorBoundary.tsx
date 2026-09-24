// Ошибка при показе страницы: вместо белого экрана — понятное сообщение, «Повторить» (без
// перезагрузки вкладки), «Обновить страницу» и подробности для администратора. Каждая
// ошибка уходит в «Журнал действий» (client_error). Разовую ошибку (данные пришли в
// неудачном порядке) сначала пробуем пройти сами — повторной отрисовкой.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { describeError, reportError } from '../lib/errors';
import { Button, Empty, Spinner } from './index';

type Props = { children: ReactNode; where?: string };
type State = { error: unknown; retries: number; auto: boolean };

const AUTO_RETRIES = 1;
const QUIET_MS = 15000;      // через столько спокойной работы счёт попыток начинается заново

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retries: 0, auto: false };
  private timer = 0;
  private lastError = 0;

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error);
    reportError(error, this.props.where || 'page', info.componentStack);
    const now = Date.now();
    const tries = now - this.lastError < QUIET_MS ? this.state.retries : 0;
    this.lastError = now;
    if (tries < AUTO_RETRIES) {
      this.setState({ auto: true, retries: tries });
      this.timer = window.setTimeout(this.retry, 250);
    } else {
      this.setState({ retries: tries });
    }
  }

  componentWillUnmount() {
    window.clearTimeout(this.timer);
  }

  retry = () => {
    window.clearTimeout(this.timer);
    this.setState((s) => ({ error: null, auto: false, retries: s.retries + 1 }));
  };

  render() {
    const { error, auto } = this.state;
    if (!error) return this.props.children;
    if (auto) return <Spinner />;
    return (
      <Empty
        action={
          <div className="nm-row" style={{ justifyContent: 'center' }}>
            <Button variant="primary" icon={RotateCcw} onClick={this.retry}>Повторить</Button>
            <Button icon={RefreshCw} onClick={() => window.location.reload()}>Обновить страницу</Button>
          </div>
        }
      >
        На странице произошла ошибка. Нажмите «Повторить» — если не поможет, обновите страницу.
        <details className="nm-error-details">
          <summary>Подробности для администратора</summary>
          <code>{describeError(error)}</code>
        </details>
      </Empty>
    );
  }
}
