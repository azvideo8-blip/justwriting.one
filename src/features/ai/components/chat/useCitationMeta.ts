import { useState, useEffect, useCallback } from 'react';
import type { AIDialogue } from '../../../../core/storage/localDb';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import type { ArchiveSession } from '../../../archive/types';
import { CITATION_RE, isRecognisedCitation } from '../../shared/citationPatterns';

export type ChatMessage = AIDialogue['messages'][number];

type CitationInfo = { date: string; title: string };

export function useCitationMeta(
  displayMessages: readonly ChatMessage[],
  streamingMessage: string | null,
  setPreviewSession: (session: ArchiveSession) => void,
): {
  processCitations: (text: string | null | undefined) => string;
  handleCitationClick: (id: string) => void;
} {
  const [citationMeta, setCitationMeta] = useState<Record<string, CitationInfo>>({});

  useEffect(() => {
    const ids = new Set<string>();
    const citeRegex = new RegExp(CITATION_RE.source, CITATION_RE.flags);

    displayMessages.forEach(msg => {
      let match;
      const content = msg.content || '';
      citeRegex.lastIndex = 0;
      while ((match = citeRegex.exec(content)) !== null) {
        const raw = match[0];
        const id = match[1];
        if (id && isRecognisedCitation(raw, id)) {
          ids.add(id);
        }
      }
      if (msg.reasoning) {
        citeRegex.lastIndex = 0;
        while ((match = citeRegex.exec(msg.reasoning)) !== null) {
          const raw = match[0];
          const id = match[1];
          if (id && isRecognisedCitation(raw, id)) {
            ids.add(id);
          }
        }
      }
    });

    if (streamingMessage) {
      let match;
      citeRegex.lastIndex = 0;
      while ((match = citeRegex.exec(streamingMessage)) !== null) {
        const raw = match[0];
        const id = match[1];
        if (id && isRecognisedCitation(raw, id)) {
          ids.add(id);
        }
      }
    }

    if (ids.size === 0) return;

    void (async () => {
      try {
        const db = await getLocalDb();
        const newMeta = { ...citationMeta };
        let updated = false;
        for (const id of ids) {
          if (newMeta[id]) continue;
          const doc = await db.get('documents', id);
          if (doc) {
            const date = doc.lastSessionAt
              ? new Date(doc.lastSessionAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
              : 'Заметка';
            newMeta[id] = {
              date,
              title: doc.title || 'Без названия',
            };
            updated = true;
          }
        }
        if (updated) {
          setCitationMeta(newMeta);
        }
      } catch (e) {
        console.warn('[AIPage] failed to fetch citation metadata:', e);
      }
    })();
  }, [displayMessages, streamingMessage, citationMeta]);

  const processCitations = (text: string | null | undefined): string => {
    if (!text) return '';
    return text.replace(CITATION_RE, (match, g1, g2) => {
      const id = g2 || g1 || '';
      if (!isRecognisedCitation(match, id)) {
        return match;
      }
      const info = citationMeta[id];
      if (info) {
        return `[📅 ${info.date}](#cite-${id})`;
      }
      // No metadata yet (still loading, or the lookup failed once and the effect
      // won't re-run). Keep the citation clickable — handleCitationClick resolves
      // the document itself — and just omit the date.
      return `[📅](#cite-${id})`;
    });
  };

  const handleCitationClick = useCallback((id: string) => {
    void (async () => {
      try {
        const db = await getLocalDb();
        const doc = await db.get('documents', id);
        if (!doc) return;
        const content = await LocalVersionService.getLatestContent(id);
        const session: ArchiveSession = {
          id: doc.id,
          userId: doc.guestId,
          title: doc.title || 'Без названия',
          content: content || '',
          duration: doc.totalDuration || 0,
          wordCount: doc.totalWords || 0,
          charCount: content ? content.length : 0,
          wpm: doc.totalWords ? Math.round(doc.totalWords / (doc.totalDuration / 60 || 1)) : 0,
          tags: doc.tags ?? [],
          labelId: doc.labelId,
          mood: doc.mood,
          createdAt: doc.firstSessionAt || doc.lastSessionAt || Date.now(),
          sessionStartTime: doc.firstSessionAt,
          _isLocal: true,
        };
        setPreviewSession(session);
      } catch (e) {
        console.error('[AIPage] failed to preview cited note:', e);
      }
    })();
  }, [setPreviewSession]);

  return { processCitations, handleCitationClick };
}
