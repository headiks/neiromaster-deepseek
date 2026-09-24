// Подтверждение и ввод строки в окне Glass вместо confirm()/prompt() браузера.
// const ok = await confirm({ title, text, danger }); const name = await prompt({ … }).
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { Button, Field, Input } from './index';

type ConfirmOpts = { title: string; text?: ReactNode; ok?: string; cancel?: string; danger?: boolean };
type PromptOpts = { title: string; text?: ReactNode; label?: string; value?: string; ok?: string; placeholder?: string };
type Ask = { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void };

type Ctx = { confirm: (o: ConfirmOpts) => Promise<boolean>; prompt: (o: PromptOpts) => Promise<string | null> };
const ConfirmCtx = createContext<Ctx>({ confirm: async () => false, prompt: async () => null });

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [value, setValue] = useState('');
  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setAsk({ kind: 'confirm', opts, resolve })), []);
  const prompt = useCallback((opts: PromptOpts) => new Promise<string | null>((resolve) => {
    setValue(opts.value || '');
    setAsk({ kind: 'prompt', opts, resolve });
  }), []);
  const done = (ok: boolean) => {
    if (!ask) return;
    if (ask.kind === 'confirm') ask.resolve(ok);
    else ask.resolve(ok ? value : null);
    setAsk(null);
  };
  const o = ask?.opts;
  return (
    <ConfirmCtx.Provider value={{ confirm, prompt }}>
      {children}
      <Dialog open={!!ask} onClose={() => done(false)} title={o?.title || ''}
              footer={<>
                <Button variant="ghost" onClick={() => done(false)}>{(o as ConfirmOpts)?.cancel || 'Отмена'}</Button>
                <Button variant={(o as ConfirmOpts)?.danger ? 'danger' : 'primary'} onClick={() => done(true)} autoFocus>
                  {o?.ok || 'Продолжить'}
                </Button>
              </>}>
        {o?.text && <div className="nm-pre" style={{ lineHeight: 1.5 }}>{o.text}</div>}
        {ask?.kind === 'prompt' && (
          <Field label={ask.opts.label}>
            <Input value={value} placeholder={ask.opts.placeholder} onChange={(e) => setValue(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } }} autoFocus />
          </Field>
        )}
      </Dialog>
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);
