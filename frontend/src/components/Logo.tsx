// Векторный лого-марк (нейро-схема) — как в исходных шапках и карточке входа.
export default function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg className="nm-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4}>
      <rect x="3" y="3" width="18" height="18" />
      <circle cx="8" cy="9" r="1.5" />
      <circle cx="16" cy="9" r="1.5" />
      <circle cx="12" cy="16" r="1.5" />
      <path d="M9.7 9H14.3M8.84 10.48 11.16 14.52M15.16 10.48 12.84 14.52" />
    </svg>
  );
}
