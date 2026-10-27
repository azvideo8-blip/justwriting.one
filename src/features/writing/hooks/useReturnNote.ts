import { useEffect, useState } from 'react';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { reportError } from '../../../shared/errors/reportError';
import { useStartOfToday } from '../../../shared/hooks/useStartOfToday';
import { onDomainEvent } from '../../../core/events/domainEvents';
import { localDocToLifeLog } from '../utils/lifeLogUtils';
import { pickReturnNote } from '../utils/returnNote';
import type { LifeLogDocument } from '../types/lifeLog';

/** RA1-3: последняя запись прошлых дней — источник карточки «Продолжить». */
/** `undefined` — ещё не прочитано (или читается для нового владельца), `null` — нечего показать. */
export function useReturnNote(userId: string): LifeLogDocument | null | undefined {
  // BR-15 (ревью 0.10.11): находка хранится вместе с владельцем, которого она
  // касается, — тот же снимок, что `useOnThisDayHome`. Экран при гость → аккаунт
  // не перемонтируется (вход — модалка поверх), поэтому прежняя карточка
  // оставалась наружу, пока читается новый человек, а сбой загрузки и поздний
  // ответ прежнего владельца дописывались поверх чужой.
  const [state, setState] = useState<{ owner: string; note: LifeLogDocument | null | undefined }>({ owner: userId, note: undefined });
  const [revision, setRevision] = useState(0);
  const startOfToday = useStartOfToday();

  // DY6-6 (приёмка 26.10, Н-4): те же четыре события и возврат вкладки, что у
  // «В этот день» (BR-12). Удаление/корзина/скрытие из архива или «Моя жизнь»
  // раньше не трогали карточку до следующего сохранения.
  useEffect(() => onDomainEvent((e) => {
    if (e.type !== 'note.saved' && e.type !== 'note.trashed' && e.type !== 'note.deleted' && e.type !== 'note.excludedFromAI') return;
    if ('userId' in e && e.userId !== undefined && e.userId !== userId) return;
    setRevision(v => v + 1);
  }), [userId]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setRevision(v => v + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const docs = await LocalDocumentService.getDocumentsByOwner(userId);
        if (!active) return;
        const picked = pickReturnNote(docs, startOfToday.getTime());
        setState({ owner: userId, note: picked ? localDocToLifeLog(picked, !!picked.linkedCloudId) : null });
      } catch (e) {
        // Сбой чтения = карточки нет, а не та, что осталась от прежнего чтения.
        reportError(e, { action: 'returnNote/load', userId });
        if (active) setState({ owner: userId, note: null });
      }
    };
    void load();
    return () => { active = false; };
  }, [userId, startOfToday, revision]);

  return state.owner === userId ? state.note : undefined;
}
