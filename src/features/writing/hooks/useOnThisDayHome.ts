import { useEffect, useState } from 'react';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { reportError } from '../../../shared/errors/reportError';
import { useLanguage } from '../../../shared/i18n';
import { onDomainEvent } from '../../../core/events/domainEvents';
import { findMatch } from '../../../core/components/OnThisDayCard';
import type { ArchiveSession } from '../../../shared/types/common';

/**
 * RA1-7: «В этот день» на главном. Берём локальные заметки (корзина и
 * скрытые от ИИ — не воспоминание, их не показываем вовсе), обе даты жизни
 * заметки считаем подходами, текст грузим только для найденной заметки.
 */
export function useOnThisDayHome(userId: string, enabled: boolean): ArchiveSession | null {
  const { t } = useLanguage();
  // BR-13: находка хранится вместе с владельцем, которого она касается.
  // Сброс эффектом не нужен (и линтер его запрещает): чужая строка не
  // совпадёт с текущим userId и наружу не выйдет.
  const [state, setState] = useState<{ owner: string; match: ArchiveSession | null }>({ owner: userId, match: null });
  const [revision, setRevision] = useState(0);

  useEffect(() => onDomainEvent((e) => {
    // BR-12: раньше перечитка была только по `note.saved`. Заметку убрали в
    // корзину или скрыли от ИИ — и карточка продолжала её показывать до
    // следующего сохранения, то есть несла наружу то, человек чего прятал.
    if (e.type !== 'note.saved' && e.type !== 'note.trashed' && e.type !== 'note.deleted' && e.type !== 'note.excludedFromAI') return;
    if ('userId' in e && e.userId !== undefined && e.userId !== userId) return;
    // После сохранения текст и даты могли измениться — пересчитать.
    setRevision(v => v + 1);
  }), [userId]);

  // BR-12: правку сделали в другой вкладке — событий здесь не было. Возврат
  // вкладки на передний план перечитывает карточку.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setRevision(v => v + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    if (!enabled || !userId) return;
    let active = true;
    const load = async () => {
      const docs = (await LocalDocumentService.getDocumentsByOwner(userId))
        .filter(d => !d.trashedAt && !d.excludedFromAI);
      const sessions = docs.map((d): ArchiveSession => {
        const sittings = [
          { id: `${d.id}_first`, documentId: d.id, version: 0, savedAt: d.firstSessionAt },
          ...(d.lastSessionAt !== d.firstSessionAt
            ? [{ id: `${d.id}_last`, documentId: d.id, version: 0, savedAt: d.lastSessionAt }]
            : []),
        ];
        return {
          id: d.id,
          userId,
          content: '',
          duration: d.totalDuration,
          wordCount: d.totalWords,
          charCount: 0,
          wpm: 0,
          title: d.title,
          tags: d.tags,
          createdAt: new Date(d.firstSessionAt),
          sessionStartTime: d.lastSessionAt,
          sittings,
          _isLocal: true,
          _linkedCloudId: d.linkedCloudId,
          _locked: d._locked,
          _decryptionError: d._decryptionError,
          trashedAt: d.trashedAt,
        };
      });
      const found = findMatch(sessions, t, new Date());
      if (!found) {
        if (active) setState({ owner: userId, match: null });
        return;
      }
      const session = { ...found.session };
      if (!session._locked && !session._decryptionError) {
        try {
          session.content = await LocalVersionService.getLatestContent(session.id);
        } catch {
          session._contentError = true;
        }
      }
      if (active) setState({ owner: userId, match: session });
    };
    void load().catch((e) => {
      reportError(e, { action: 'onThisDayHome/load', userId });
      if (active) setState({ owner: userId, match: null });
    });
    return () => { active = false; };
  }, [enabled, userId, t, revision]);



  return enabled && state.owner === userId ? state.match : null;
}
