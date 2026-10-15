import type { Label } from '../../../types';

/** MF-13: метка на телефоне — точка 8 px и имя её цветом. Подкраска строки в
 *  4 % не читалась, полосу слева MC-7 убрал. */
export function LabelMark({ label }: { label: Label }) {
  return (
    <span data-label-mark className="inline-flex min-w-0 items-center gap-1.5">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
      {/* Чистый цвет метки на 10 % подкраске даёт 3,1–5,1:1; с 30 % цвета текста —
          не ниже 5,1:1 во всех четырёх темах и четырёх готовых цветах. */}
      <span className="truncate" style={{ color: `color-mix(in srgb, ${label.color} 70%, var(--text-main))` }}>{label.name}</span>
    </span>
  );
}
