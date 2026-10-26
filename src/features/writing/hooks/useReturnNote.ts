import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { reportError } from '../../../shared/errors/reportError';
import { useStartOfToday } from '../../../shared/hooks/useStartOfToday';
import { onDomainEvent } from '../../../core/events/domainEvents';
import { localDocToLifeLog } from '../utils/lifeLogUtils';
import { pickReturnNote } from '../utils/returnNote';
import type { LifeLogDocument } from '../types/lifeLog';

/** RA1-3: последняя запись прошлых дней — источник карточки «Продолжить». */
export function useReturnNote(userId: string): LifeLogDocument | null {
  const [note, setNote] = useState<LifeLogDocument | null>(null);
  const mountedRef = useRef(true);
  const startOfToday = useStartOfToday();

  const load = useCallback(async () => {
    try {
      const docs = await LocalDocumentService.getDocumentsByOwner(userId);
      if (!mountedRef.current) return;
      const picked = pickReturnNote(docs, startOfToday.getTime());
      setNote(picked ? localDocToLifeLog(picked, !!picked.linkedCloudId) : null);
    } catch (e) {
      reportError(e, { action: 'returnNote/load', userId });
    }
  }, [userId, startOfToday]);

  useEffect(() => {
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка из IndexedDB: setState после await, правило ложно срабатывает на вызов
    void load();
    return () => { mountedRef.current = false; };
  }, [load]);

  useEffect(() => onDomainEvent((e) => {
    if (e.type !== 'note.saved') return;
    if (e.userId !== undefined && e.userId !== userId) return;
    void load();
  }), [load, userId]);

  return note;
}
