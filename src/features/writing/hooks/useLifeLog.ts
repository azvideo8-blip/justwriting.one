import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DocumentService } from '../../../core/services/DocumentService';
import { isUnreadableCloudList } from '../../../core/services/cloudListPartial';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { VersionService } from '../../../core/services/VersionService';
import { Document } from '../../../types';
import { useLanguage } from '../../../shared/i18n';
import { useStartOfToday } from '../../../shared/hooks/useStartOfToday';
import {
  localDocToLifeLog,
  mergeUnifiedDocuments,
  groupSessionsByDate,
  computeDailySummary,
} from '../utils/lifeLogUtils';
import { LifeLogDocument, DailySummary, SessionGroup } from '../types/lifeLog';
import { reportError } from '../../../shared/errors/reportError';
import { onDomainEvent } from '../../../core/events/domainEvents';

interface UseLifeLogReturn {
  sessionGroups: SessionGroup[];
  documents: Document[];
  unifiedDocuments: LifeLogDocument[];
  summary: DailySummary;
  loading: boolean;
  cloudUnknown: boolean;
  refresh: () => Promise<void>;
}

export function useLifeLog(userId: string, isGuest: boolean): UseLifeLogReturn {
  // DY6-7 (приёмка 26.10, Н-5): тот же ключ владельца, что у BR-13/BR-15. Хук
  // живёт в контексте сессии и при гость → аккаунт не перемонтируется; без ключа
  // поздний ответ прежнего владельца перезаписывал чужой экран, а переход на
  // пустой id оставлял старый список наружу.
  const [data, setData] = useState<{
    owner: string;
    documents: Document[];
    unified: LifeLogDocument[];
    loading: boolean;
    cloudUnknown: boolean;
  }>({ owner: userId, documents: [], unified: [], loading: true, cloudUnknown: false });
  const { t, language } = useLanguage();
  const mountedRef = useRef(true);
  // DY6-7: поздний ответ сверяется с НАСТОЯЩИМ владельцем — замыкание fetch
  // видит свой userId и подмены бы не заметило.
  const currentOwnerRef = useRef(userId);
  useEffect(() => { currentOwnerRef.current = userId; }, [userId]);
  const startOfToday = useStartOfToday();

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const fetchSessions = useCallback(async () => {
    const ownerAtRequest = userId;
    // Ключ не двигаем: чужой владелец ещё не прочитан, и наружу должно выйти
    // «читается», а не прежний список (его прячет производный снимок ниже).
    setData(s => (s.owner === ownerAtRequest ? { ...s, loading: true, cloudUnknown: false } : s));
    try {
      let localDocs: Awaited<ReturnType<typeof LocalDocumentService.getDocumentsByOwner>> = [];
      let didFail = false;
      try {
        localDocs = await LocalDocumentService.getDocumentsByOwner(userId);
      } catch (e) {
        reportError(e, { action: 'lifeLog/fetchLocalDocs' });
        didFail = true;
      }

      let cloudDocs: Document[] = [];
      if (!isGuest) {
        try {
          cloudDocs = await DocumentService.getUserDocuments(userId);
        } catch (e) {
          // R-2: прочитанная часть идёт в журнал, облако — «неизвестно».
          if (isUnreadableCloudList(e)) cloudDocs = e.docs;
          reportError(e, { action: 'lifeLog/fetchCloudDocs' });
          didFail = true;
        }
      }

      if (!mountedRef.current) return;
      const rawUnified = isGuest
        ? localDocs.map(d => localDocToLifeLog(d, false))
        : mergeUnifiedDocuments(localDocs, cloudDocs);

      const startTs = startOfToday.getTime();
      const unifiedWithVersions = await Promise.all(
        rawUnified.map(async doc => {
          if (doc.lastSessionAt < startTs) return doc;
          try {
            if (doc.localId) {
              const vers = await LocalVersionService.getVersions(doc.localId);
              return {
                ...doc,
                versions: vers.map(v => ({
                  wordsAdded: v.wordsAdded ?? v.wordCount,
                  duration: v.duration,
                  savedAt: v.savedAt,
                })),
              };
            } else if (doc.cloudId && !isGuest) {
              const vers = await VersionService.getVersions(userId, doc.cloudId);
              return {
                ...doc,
                versions: vers.map(v => ({
                  wordsAdded: v.wordsAdded ?? v.wordCount,
                  duration: v.duration,
                  savedAt: v.savedAt ? new Date(v.savedAt).getTime() : 0,
                })),
              };
            }
          } catch {
            // fallback gracefully without versions
          }
          return doc;
        })
      );

      if (!mountedRef.current) return;
      if (ownerAtRequest !== currentOwnerRef.current) return;
      // Ход нового владельца: снимок целиком, вместе с ключом.
      setData({ owner: ownerAtRequest, documents: cloudDocs, unified: unifiedWithVersions, loading: false, cloudUnknown: didFail });
    } catch (e) {
      reportError(e, { action: 'lifeLog/fetchSessions' });
    } finally {
      if (mountedRef.current && ownerAtRequest === currentOwnerRef.current) {
        setData(s => (s.owner === ownerAtRequest ? { ...s, loading: false } : s));
      }
    }
  }, [userId, isGuest, startOfToday]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch from local and cloud stores on mount/user change
    void fetchSessions();
  }, [fetchSessions]);

  // MC-4: `handleSave` обновляет лог жизни у СВОЕГО экземпляра хука, а шапка
  // письма читает другой — из-за этого счётчик серии жил до перезагрузки
  // страницы. Подписка на событие сохранения носит весть всем экземплярам.
  useEffect(() => onDomainEvent((e) => {
    if (e.type !== 'note.saved') return;
    if (e.userId !== undefined && e.userId !== userId) return;
    void fetchSessions();
  }), [fetchSessions, userId]);

  // BR-13: состояние ключуется владельцем — чужая строка не совпадёт с текущим
  // userId и наружу не выйдет (возврата прежнего списка при смене тоже нет:
  // данные нового владельца ещё не прочитаны). useMemo — чтобы производные
  // summary/группы не пересобирались на каждый рендер.
  const { documents, unifiedDocuments, loading, cloudUnknown } = useMemo(() => (
    data.owner === userId
      ? { documents: data.documents, unifiedDocuments: data.unified, loading: data.loading, cloudUnknown: data.cloudUnknown }
      : { documents: [] as Document[], unifiedDocuments: [] as LifeLogDocument[], loading: true, cloudUnknown: false }
  ), [data, userId]);

  const summary = useMemo(
    () => computeDailySummary(unifiedDocuments, startOfToday),
    [unifiedDocuments, startOfToday]
  );

  const sessionGroups = useMemo(
    () => groupSessionsByDate(unifiedDocuments, startOfToday, t, language),
    [unifiedDocuments, startOfToday, t, language]
  );

  return {
    sessionGroups,
    documents,
    unifiedDocuments,
    summary,
    loading,
    cloudUnknown,
    refresh: fetchSessions,
  };
}
