// Модальное окно на <dialog>: фокус внутри, Escape закрывает, фон затемнён.
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, cx } from './index';

export function Dialog({ open, onClose, title, subtitle, children, footer, wide, modal = true, className }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode;
  footer?: ReactNode; wide?: boolean; modal?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { if (modal) d.showModal(); else d.show(); }
    if (!open && d.open) d.close();
  }, [open, modal]);
  return (
    <dialog ref={ref} className={cx('nm-dialog', wide && 'nm-dialog-wide', className)}
            onCancel={(e) => { e.preventDefault(); onClose(); }}
            onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <>
          <div className="nm-dialog-head">
            <div className="nm-grow">
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <Button variant="ghost" iconOnly icon={X} aria-label="Закрыть" onClick={onClose} />
          </div>
          <div className="nm-dialog-body">{children}</div>
          {footer && <div className="nm-dialog-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
