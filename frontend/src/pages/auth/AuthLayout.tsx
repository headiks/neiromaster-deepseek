// Экран входа/регистрации/первого входа: одна стеклянная карточка 400px по центру.
import type { ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useThemeMode } from '../../lib/theme';
import { Button, Card, Logo } from '../../ui';

export function AuthLayout({ title, subtitle, children, onSubmit, footer }: {
  title: ReactNode; subtitle?: ReactNode; children: ReactNode; onSubmit: () => void; footer?: ReactNode;
}) {
  const { dark, toggle } = useThemeMode();
  return (
    <main className="nm-auth">
      <div className="nm-auth-theme">
        <Button variant="ghost" iconOnly icon={dark ? Sun : Moon} aria-label={dark ? 'Светлая тема' : 'Тёмная тема'} onClick={toggle} />
      </div>
      <Card as="section" className="nm-auth-card">
        <form className="nm-stack" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); onSubmit(); }} noValidate>
          <div className="nm-auth-mark">
            <Logo size={44} />
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {children}
        </form>
        {footer && <div className="nm-auth-foot">{footer}</div>}
      </Card>
    </main>
  );
}
