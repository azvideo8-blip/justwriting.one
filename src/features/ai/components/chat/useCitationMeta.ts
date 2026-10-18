import { useState, useEffect, useCallback, useRef } from 'react';
import type { AIDialogue, LocalDocument } from '../../../../core/storage/localDb';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import type { ArchiveSession } from '../../../../shared/types/common';
import { CITATION_RE, isRecognisedCitation } from '../../shared/citationPatterns';

export type ChatMessage = AIDialogue['messages'][number];

type CitationInfo = { date: string; title: string };

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;

/**
 * Индекс заметок за один проход по базе. Заметка ищется по номеру из ссылки,
 * а в контекст модели идёт локальный id — у одной заметки на разных устройствах
 * локальные id разные, диалоги же синхронизируются. Поэтому ключей три: локальный
 * id, uuid и облачный id (последние общие для устройств). Прежний код делал
 * db.getAll на КАЖДЫЙ ненайденный id; здесь — ровно один getAll на проход.
 * При нескольких копиях с одним ключом берём живую: у копии из корзины стоит
 * trashedAt, и она не должна выигрывать у существующей заметки.
 */
async function buildDocIndex(db: LocalDb) {
  const index = new Map<string, LocalDocument>();
  const all = await db.getAll('documents');
  for (const doc of all) {
    for (const key of [doc.id, doc.uuid, doc.linkedCloudId]) {
      if (!key) continue;
      const prev = index.get(key);
      // Живая копия важнее корзины: корзину перетираем живой, живую не трогаем.
      if (!prev || (prev.trashedAt && !doc.trashedAt)) index.set(key, doc);
    }
  }
  return index;
}

/**
 * Заметка по id ссылки. Возвращает живую копию: если под одним uuid/облачным id
 * легли и обычная, и удалённая копия, открывается обычная.
 */
async function findCitedDocument(db: LocalDb, id: string) {
  const index = await buildDocIndex(db);
  return index.get(id);
}

export function useCitationMeta(
  displayMessages: readonly ChatMessage[],
  streamingMessage: string | null,
  setPreviewSession: (session: ArchiveSession) => void,
  onMissing?: () => void,
): {
  processCitations: (text: string | null | undefined) => string;
  handleCitationClick: (id: string) => void;
} {
  const [citationMeta, setCitationMeta] = useState<Record<string, CitationInfo>>({});
  // Кеш по id: значение — найденная мета, null — «такой заметки нет на устройстве».
  // Промах тоже помним, иначе эффект на каждый кусок потока перечитывал бы базу.
  const metaCacheRef = useRef<Record<string, CitationInfo | null>>({});
  // Id уже в полёте: не запускаем второй getAll, пока первый не доехал.
  const inflightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const ids = new Set<string>();
    const citeRegex = new RegExp(CITATION_RE.source, CITATION_RE.flags);

    const collect = (content: string | null | undefined) => {
      if (!content) return;
      let match;
      citeRegex.lastIndex = 0;
      while ((match = citeRegex.exec(content)) !== null) {
        const raw = match[0];
        // id — вторая группа для [#…] и первая для маркера поиска; как в
        // processCitations. Прежний код брал только match[1] и потому никогда
        // не собирал ссылки вида [#id] — мета для них не заводилась вовсе.
        const id = match[2] || match[1];
        if (id && isRecognisedCitation(raw, id)) ids.add(id);
      }
    };

    displayMessages.forEach(msg => {
      collect(msg.content);
      collect(msg.reasoning);
    });
    collect(streamingMessage);

    if (ids.size === 0) return;

    // Берём только те id, которых ещё нет ни в кеше, ни в полёте. Один проход —
    // один getAll на все новые id сразу; промахи больше не перечитываются.
    const pending = [...ids].filter(id => !(id in metaCacheRef.current) && !inflightRef.current.has(id));
    if (pending.length === 0) return;
    pending.forEach(id => inflightRef.current.add(id));

    void (async () => {
      try {
        const db = await getLocalDb();
        const index = await buildDocIndex(db);
        const resolved: Record<string, CitationInfo> = {};
        for (const id of pending) {
          inflightRef.current.delete(id);
          const doc = index.get(id);
          if (doc) {
            const date = doc.lastSessionAt
              ? new Date(doc.lastSessionAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
              : 'Заметка';
            const info: CitationInfo = { date, title: doc.title || 'Без названия' };
            metaCacheRef.current[id] = info;
            resolved[id] = info;
          } else {
            metaCacheRef.current[id] = null; // запоминаем промах
          }
        }
        if (Object.keys(resolved).length > 0) {
          setCitationMeta(prev => ({ ...prev, ...resolved }));
        }
      } catch (e) {
        console.warn('[AIPage] failed to fetch citation metadata:', e);
        // Сбой чтения — не фиксируем промах, в следующий проход попробуем снова.
        pending.forEach(id => inflightRef.current.delete(id));
      }
    })();
    // citationMeta не в зависимостях: результат держим в ref-кеше, иначе эффект
    // перезапускался бы на каждое setCitationMeta и гонял getAll повторно.
  }, [displayMessages, streamingMessage]);

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
        const doc = await findCitedDocument(db, id);
        if (!doc) { onMissing?.(); return; }
        const content = await LocalVersionService.getLatestContent(doc.id);
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
  }, [setPreviewSession, onMissing]);

  return { processCitations, handleCitationClick };
}
