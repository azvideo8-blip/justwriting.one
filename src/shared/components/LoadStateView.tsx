import type { ReactNode } from 'react';
import { Button } from './Button';
import { cn } from '../utils/cn';
import { useLanguage } from '../i18n';
import type { LoadState } from '../loadState';

interface LoadNoticeProps {
  text: string;
  /** Обязателен: панель «не прочиталось» без выхода не собирается. */
  onRetry: () => void;
  /** `panel` — вместо содержимого; `row` — строка над содержимым, которое осталось на экране. */
  variant: 'panel' | 'row';
  /** Второй выход рядом с «Повторить» (выгрузка: «только с этого устройства»). */
  extra?: { label: string; onClick: () => void };
  icon?: ReactNode;
  className?: string;
}

/**
 * Единственная панель «не прочиталось + Повторить». Самодельные копии
 * (`accent-danger/10` + `t('retry')`) считает храповик check-load-state.
 */
export function LoadNotice({ text, onRetry, variant, extra, icon, className }: LoadNoticeProps) {
  const { t } = useLanguage();
  if (variant === 'row') {
    return (
      <div role="alert" className={cn('px-4 py-3 rounded-2xl text-sm bg-accent-danger/10 border border-accent-danger/30 text-accent-danger flex items-center justify-between gap-3', className)}>
        <span>{text}</span>
        <span className="shrink-0 flex gap-3">
          <Button onClick={onRetry} className="underline text-accent-danger/70 hover:text-accent-danger">{t('retry')}</Button>
          {extra && <Button onClick={extra.onClick} className="underline text-accent-danger/70 hover:text-accent-danger">{extra.label}</Button>}
        </span>
      </div>
    );
  }
  return (
    <div role="alert" className={cn('p-12 text-center rounded-2xl border bg-accent-danger/10 border-accent-danger/20', className)}>
      {icon}
      <p className="text-accent-danger text-sm mb-4">{text}</p>
      <Button onClick={onRetry} className="px-4 py-2 rounded-xl text-sm font-medium text-accent-danger border border-accent-danger/30 hover:bg-accent-danger/10 transition-colors">{t('retry')}</Button>
      {extra && <Button onClick={extra.onClick} className="ml-3 px-4 py-2 rounded-xl text-sm font-medium text-accent-danger/80 underline">{extra.label}</Button>}
    </div>
  );
}

interface LoadStateViewProps<T> {
  state: LoadState<T>;
  /** Пока читаем и показать нечего. */
  loading: ReactNode;
  /** Чтение не удалось; `retry` приходит из состояния. Без прошлых данных — вместо содержимого, с ними — уходит в `notice`. */
  error: (retry: () => void) => ReactNode;
  /** Ошибка перечитывания, когда прошлые данные на экране (строка над ними); по умолчанию — `error`. */
  errorWithData?: (retry: () => void) => ReactNode;
  /** Локальное есть, облако не прочиталось — плашка рядом с данными. */
  partial: (retry: () => void) => ReactNode;
  /** Прочитано целиком, и там ничего нет. */
  empty: ReactNode;
  /**
   * `notice` — то, что обязано быть на экране рядом с данными: плашка `partial`
   * или ошибка перечитывания поверх прошлых данных; иначе `null`. Место в
   * вёрстке выбирает экран.
   */
  children: (data: T, notice: ReactNode) => ReactNode;
}

/**
 * Разбор состояния чтения — один на все входы (телефон, десктоп, вкладка).
 * Все пять веток обязательны: экран не может «забыть» ошибку или частичный
 * отказ — без них компонент не соберётся.
 */
export function LoadStateView<T>({ state, loading, error, errorWithData, partial, empty, children }: LoadStateViewProps<T>) {
  switch (state.status) {
    case 'loading': return <>{state.stale === undefined ? loading : children(state.stale, null)}</>;
    case 'error': return <>{state.stale === undefined ? error(state.retry) : children(state.stale, (errorWithData ?? error)(state.retry))}</>;
    case 'empty': return <>{empty}</>;
    case 'partial': return <>{children(state.data, partial(state.retry))}</>;
    case 'data': return <>{children(state.data, null)}</>;
  }
}
