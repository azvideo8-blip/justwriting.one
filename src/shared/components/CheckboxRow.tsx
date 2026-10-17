import { type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * MQ-12 (N-3): поле галочки в мастере первого входа — 24 px, а на телефоне цель
 * касания должна быть 44 px. Квадрат остаётся 24 px (дизайн не меняется), а
 * зоной нажатия становится вся строка: прозрачный `input` растянут по строке,
 * квадрат нарисован рядом и берёт состояние ввода через `peer`.
 *
 * Рендерить `input` растянутым, а не `sr-only`, важно по двум причинам:
 * `smallTargets` в мобильных спеках меряет сам контрол (у clipped-элемента он
 * выпал бы из проверки — это была бы подделка замера), и клик Playwright'а
 * попадает именно в ввод, а не в нарисованный квадрат.
 */
export function CheckboxRow({ checked, onChange, children, className, labelClassName }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <label className={clsx('relative flex min-h-11 cursor-pointer items-start gap-3', className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none opacity-0"
      />
      <span
        aria-hidden="true"
        className={clsx(
          'mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-[var(--border-light)] transition-colors',
          'peer-checked:border-brand-soft peer-checked:bg-brand-soft',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--brand-soft)]',
        )}
      >
        {checked && <Check size={14} className="text-[var(--bg-base)]" />}
      </span>
      {/* Текст — над растянутым input: ссылки в нём (политика, условия) обязаны
          открываться, а не ставить галочку. Касание по самому тексту всё равно
          переключает галочку — это поведение <label> (ревью 0.10.0). */}
      <span className={clsx('relative z-20 min-w-0 flex-1', labelClassName)}>{children}</span>
    </label>
  );
}
