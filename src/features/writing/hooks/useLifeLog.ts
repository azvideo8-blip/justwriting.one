import { useState, useEffect, useCallback, useMemo } from 'react';
import { DocumentService } from '../services/DocumentService';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { StorageState } from '../services/StorageService';
import { Session, Document } from '../../../types';
import { SessionService } from '../services/SessionService';
import { LocalDocument, LocalVersion, getLocalDb } from '../../../shared/lib/localDb';
import { parseFirestoreDate } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';

export interface LifeLogDocument {
  localId?: string;
  cloudId?: string;
  title: string;
  totalWords: number;
  totalDuration: number;
  currentVersion: number;
  sessionsCount: number;
  lastSessionAt: number;
  tags: string[];
  storage: StorageState;
}

export interface DailySummary {
  totalWords: number;
  totalMinutes: number;
}

export interface SessionGroup {
  label: string;
  date: Date;
  sessions: Session[];
}

interface UseLifeLogReturn {
  sessionGroups: SessionGroup[];
  documents: Document[];
  unifiedDocuments: LifeLogDocument[];
  summary: DailySummary;
  loading: boolean;
  refresh: () => Promise<void>;
}

function localDocToSession(doc: LocalDocument, content: string): Session {
  return {
    id: doc.id,
    userId: doc.guestId,
    authorName: '',
    authorPhoto: '',
    content,
    duration: doc.totalDuration,
    wordCount: doc.totalWords,
    charCount: 0,
    wpm: 0,
    isPublic: false,
    title: doc.title,
    tags: doc.tags,
    createdAt: new Date(doc.lastSessionAt),
    _isLocal: true,
  };
}

async function getLatestContentForDoc(docId: string): Promise<string> {
  try {
    const db = await getLocalDb();
    const versions = await db.getAllFromIndex('versions', 'by-document', docId);
    versions.sort((a: LocalVersion, b: LocalVersion) => a.version - b.version);
    return versions[versions.length - 1]?.content ?? '';
  } catch {
    return '';
  }
}

export function useLifeLog(userId: string, isGuest?: boolean): UseLifeLogReturn {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [unifiedDocuments, setUnifiedDocuments] = useState<LifeLogDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const { t, language } = useLanguage();
  const { isGuest: authIsGuest } = useAuthStatus();
  const effectiveGuest = isGuest ?? authIsGuest;

  const [startOfToday, setStartOfToday] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      setStartOfToday(prev => {
        if (prev.getTime() === today.getTime()) return prev;
        return today;
      });
    };
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, []);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      if (effectiveGuest) {
        const localDocs = await LocalDocumentService.getGuestDocuments(userId);
        const sessionsWithContent = await Promise.all(
          localDocs.map(async d => {
            const content = await getLatestContentForDoc(d.id);
            return localDocToSession(d, content);
          })
        );
        setSessions(sessionsWithContent);
        setDocuments([]);
        setUnifiedDocuments(localDocs.map(d => ({
          localId: d.id,
          cloudId: d.linkedCloudId || undefined,
          title: d.title,
          totalWords: d.totalWords,
          totalDuration: d.totalDuration,
          currentVersion: d.currentVersion,
          sessionsCount: d.sessionsCount,
          lastSessionAt: d.lastSessionAt,
          tags: d.tags,
          storage: { local: true, cloud: !!d.linkedCloudId },
        })));
      } else {
        const [sessionResult, cloudDocs, localDocs] = await Promise.all([
          SessionService.getAllSessions(userId, 100),
          DocumentService.getUserDocuments(userId).catch(() => [] as Document[]),
          LocalDocumentService.getGuestDocuments(userId).catch(() => []),
        ]);

        setSessions(sessionResult.sessions);
        setDocuments(cloudDocs);

        const cloudById = new Map(cloudDocs.map(d => [d.id, d]));
        const cloudByTitle = new Map(cloudDocs.map(d => [d.title, d]));
        const matchedCloudIds = new Set<string>();

        const unified: LifeLogDocument[] = [];

        for (const local of localDocs) {
          const cloud = (local.linkedCloudId && cloudById.get(local.linkedCloudId))
            || cloudByTitle.get(local.title);
          if (cloud) matchedCloudIds.add(cloud.id);

          const hasCloud = !!(local.linkedCloudId || cloud);

          unified.push({
            localId: local.id,
            cloudId: local.linkedCloudId || cloud?.id,
            title: local.title,
            totalWords: local.totalWords,
            totalDuration: local.totalDuration,
            currentVersion: local.currentVersion,
            sessionsCount: local.sessionsCount,
            lastSessionAt: local.lastSessionAt,
            tags: local.tags,
            storage: {
              local: true,
              cloud: hasCloud,
            },
          });
        }

        for (const cloud of cloudDocs) {
          if (matchedCloudIds.has(cloud.id)) continue;
          unified.push({
            cloudId: cloud.id,
            title: cloud.title,
            totalWords: cloud.totalWords,
            totalDuration: cloud.totalDuration,
            currentVersion: cloud.currentVersion,
            sessionsCount: cloud.sessionsCount,
            lastSessionAt: (cloud.lastSessionAt as { toDate?: () => Date }).toDate?.().getTime() ?? Date.now(),
            tags: cloud.tags,
            storage: {
              local: false,
              cloud: true,
            },
          });
        }

        unified.sort((a, b) => b.lastSessionAt - a.lastSessionAt);
        setUnifiedDocuments(unified);
      }
    } catch (e) {
      if (import.meta.env.DEV) console.error('useLifeLog fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [userId, effectiveGuest]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const todayDocuments = unifiedDocuments.filter(d => d.lastSessionAt >= startOfToday.getTime());

  const summary: DailySummary = {
    totalWords: todayDocuments.reduce((sum, d) => sum + d.totalWords, 0),
    totalMinutes: Math.round(todayDocuments.reduce((sum, d) => sum + d.totalDuration, 0) / 60),
  };

  const sessionGroups = useMemo(() => {
    const documentTitles = new Set(unifiedDocuments.map(d => d.title).filter(Boolean));
    const dedupedSessions = sessions.filter(s => !documentTitles.has(s.title || ''));

    const groups = new Map<string, SessionGroup>();
    const yesterday = new Date(startOfToday);
    yesterday.setDate(yesterday.getDate() - 1);

    dedupedSessions.forEach(session => {
      const date = parseFirestoreDate(session.createdAt);
      if (!date) return;

      const sessionDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const key = sessionDay.toISOString();

      if (!groups.has(key)) {
        let label: string;
        if (sessionDay.getTime() === startOfToday.getTime()) {
          label = t('lifelog_group_today');
        } else if (sessionDay.getTime() === yesterday.getTime()) {
          label = t('lifelog_group_yesterday');
        } else {
          label = date.toLocaleDateString(language, {
            day: 'numeric',
            month: 'long',
          });
        }
        groups.set(key, { label, date: sessionDay, sessions: [] });
      }

      const existing = groups.get(key);
      if (existing) {
        existing.sessions.push(session);
      }
    });

    return Array.from(groups.values())
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [sessions, startOfToday, t, language]);

  return {
    sessionGroups,
    documents,
    unifiedDocuments,
    summary,
    loading,
    refresh: fetchSessions,
  };
}
