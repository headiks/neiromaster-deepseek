import { useRef, useState, type ReactNode } from 'react';

/** Зона загрузки: клик открывает выбор файла, drag-n-drop роняет файлы. */
export default function Dropzone({
  onFiles, accept, multiple, children, id,
}: {
  onFiles: (files: FileList) => void;
  accept?: string;
  multiple?: boolean;
  children: ReactNode;
  id?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      className={`dropzone${over ? ' dragover' : ''}`}
      id={id}
      onClick={() => inputRef.current?.click()}
      onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); }}
    >
      {children}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}
