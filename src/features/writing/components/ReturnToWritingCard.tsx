import React from 'react';
import { useLanguage } from '../../../shared/i18n';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import type { LifeLogDocument } from '../types/lifeLog';

interface ReturnToWritingCardProps {
  note: LifeLogDocument | null;
  onContinue: (doc: LifeLogDocument) => void;
  /** Черновик, дзен, окно настройки — карточке там не место. */
  hidden?: boolean;
  className?: string;
}

/**
 * RA1-3: вернувшемуся человеку пустой главный ничего не говорил. Карточка
 * показывает дату последней записи и «Продолжить». Текста заметки здесь нет —
 * решение владельца 2026-10-24: экран может быть открыт при ком-то.
 */
export function ReturnToWritingCard({ note, onContinue, hidden = false, className }: ReturnToWritingCardProps) {
  const { t, language } = useLanguage();
  const content = useContentStore(s => s.content);
  const status = useTimerStore(s => s.status);

  if (hidden || !note || status !== 'idle' || content.trim() !== '') return null;

  const dateLabel = new Date(note.lastSessionAt).toLocaleDateString(
    language === 'en' ? 'en-US' : 'ru-RU',
    { day: 'numeric', month: 'long' }
  );

  return (
    <div
      data-testid="return-to-writing"
      className={className ?? 'flex items-center justify-center gap-3 rounded-xl border border-border-subtle bg-surface-card/90 px-4 py-2 text-sm text-text-main/60'}
    >
      <span>{t('home_return_last_note', { date: dateLabel })}</span>
      <button
        type="button"
        onClick={() => onContinue(note)}
        className="press min-h-11 rounded-lg px-3 font-medium text-text-main hover:opacity-70"
      >
        {t('home_return_continue')}
      </button>
    </div>
  );
}
