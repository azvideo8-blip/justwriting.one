import { type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * MQ-12 (N-3): поле галочки в мастере первого входа — 24 px, а на телефоне цель
 * касания должна быть 44 px. Квадрат остаётся 24 px, а прозрачный `input`
 * растянут на 44×44 вокруг него (по 10 px с каждой стороны). Касание по тексту
 * переключает галочку как поведение `<label>`.
 *
 * Ревью 0.10.0: раньше `input` растягивался на ВСЮ строку и лежал поверх ссылок
 * в тексте согласия — «политика», «условия» ставили галочку вместо того, чтобы
 * открыться. Поднять текст над ним — тоже не выход: тогда текст закрывал сам
 * контрол. Поэтому цель 44 px — только вокруг квадрата.
 *
 * `input` не `sr-only`: `smallTargets` в мобильных спеках меряет сам контрол, и
 * клик Playwright'а попадает именно в ввод.
 */
export function CheckboxRow({ checked, onChange, children, className, labelClassName }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <label className={clsx('flex min-h-11 cursor-pointer items-start gap-3', className)}>
      <span className="relative mt-1 h-6 w-6 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="peer absolute -inset-2.5 z-10 h-11 w-11 cursor-pointer appearance-none opacity-0"
        />
        <span
          aria-hidden="true"
          className={clsx(
            'grid h-6 w-6 place-items-center rounded-md border border-[var(--border-light)] transition-colors',
            'peer-checked:border-brand-soft peer-checked:bg-brand-soft',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--brand-soft)]',
          )}
        >
          {checked && <Check size={14} className="text-[var(--bg-base)]" />}
        </span>
      </span>
      <span className={clsx('min-w-0 flex-1', labelClassName)}>{children}</span>
    </label>
  );
}
