// Зона загрузки: клик выбирает файлы, файлы можно перетащить.
import { useRef, useState, type ReactNode } from 'react';
import { Upload, type LucideIcon } from 'lucide-react';

export function Dropzone({ onFiles, accept, multiple, title, hint, icon: Icon = Upload, disabled }: {
  onFiles: (files: File[]) => void; accept?: string; multiple?: boolean; title: ReactNode; hint?: ReactNode; icon?: LucideIcon; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => { if (list && list.length) onFiles(Array.from(list)); };
  return (
    <div className="nm-drop" data-over={over || undefined} role="button" tabIndex={0} aria-disabled={disabled}
         onClick={() => !disabled && input.current?.click()}
         onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
         onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
         onDragOver={(e) => { e.preventDefault(); setOver(true); }}
         onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
         onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files); }}>
      <Icon aria-hidden />
      <b>{title}</b>
      {hint && <small>{hint}</small>}
      <input ref={input} type="file" hidden accept={accept} multiple={multiple}
             onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
    </div>
  );
}
