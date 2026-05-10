import { useState, useEffect, useRef, useMemo, Dispatch, SetStateAction } from 'react';
import { User } from 'firebase/auth';
import { format } from 'date-fns';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { DocumentService } from '../../writing/services/DocumentService';
import { StorageService } from '../../writing/services/StorageService';
import { loadAllSessions } from '../../writing/services/UnifiedSessionLoader';
import { useArchiveFilters } from '../hooks/useArchiveFilters';
import { useArchiveSearch } from '../hooks/useArchiveSearch';
import { getDateLocale } from '../../../core/utils/dateUtils';
import { ArchiveSession } from '../types';

interface UseArchiveDataReturn {
  sessions: ArchiveSession[];
  loading: boolean;
  error: string | null;
  cloudLoadFailed: boolean;
  fetchSessions: (_isRefresh?: boolean) => Promise<void>;
  handleDeleteSession: (s: ArchiveSession) => Promise<void>;
  handleTagsChange: (session: ArchiveSession, newTags: string[]) => Promise<void>;
  handleTitleChange: (session: ArchiveSession, newTitle: string) => Promise<void>;
  handleDateChange: (session: ArchiveSession, newDate: Date) => Promise<void>;
  previewSession: ArchiveSession | null;
  setPreviewSession: (s: ArchiveSession | null) => void;
  deleteConfirm: ArchiveSession | null;
  setDeleteConfirm: (s: ArchiveSession | null) => void;
  allTags: string[];
  filteredByFilters: ArchiveSession[];
  filteredSessions: ArchiveSession[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedDate: Date | null;
  setSelectedDate: (d: Date | null) => void;
  selectedMonth: Date | null;
  setSelectedMonth: (d: Date | null) => void;
  selectedTags: string[];
  setSelectedTags: Dispatch<SetStateAction<string[]>>;
  statsTitle: string;
  hasActiveFilter: boolean;
  resetStatsFilter: () => void;
  sessionsByDate: Record<string, number>;
  wordCloud: { word: string; count: number }[];
  maxCount: number;
  groupedSessions: Record<string, ArchiveSession[]>;
  sortedDates: string[];
  dateLocale: ReturnType<typeof getDateLocale>;
  entriesLabel: (n: number) => string;
}

export function useArchiveData(user: User | null, userId: string, t: (key: string) => string, language: string): UseArchiveDataReturn {
  const [sessions, setSessions] = useState<ArchiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloudLoadFailed, setCloudLoadFailed] = useState(false);
  const [previewSession, setPreviewSession] = useState<ArchiveSession | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ArchiveSession | null>(null);
  const mountedRef = useRef(true);

  const fetchSessions = async (_isRefresh = false) => {
    setLoading(true);
    setError(null);

    try {
      const result = await loadAllSessions(userId, user);
      if (!mountedRef.current) return;
      setSessions(result.sessions as ArchiveSession[]);
      setCloudLoadFailed(result.cloudLoadFailed);
    } catch (err) {
      if (!mountedRef.current) return;
      console.error('Archive load error:', err);
      setError(t('archive_load_error'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    fetchSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleDeleteSession = async (s: ArchiveSession) => {
    try {
      await StorageService.deleteDocument(
        userId,
        s._isLocal ? s.id : undefined,
        s._hasCloudCopy ? (s._linkedCloudId || s.id) : undefined
      );
      setSessions(prev => prev.filter(x => x.id !== s.id));
      if (previewSession?.id === s.id) setPreviewSession(null);
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  };

  const handleTagsChange = async (session: ArchiveSession, newTags: string[]) => {
    try {
      if (session._isLocal) {
        await LocalDocumentService.updateTags(session.id, newTags);
      } else if (user) {
        await DocumentService.updateTags(user.uid, session.id, newTags);
      }
      setSessions(prev => prev.map(s =>
        s.id === session.id ? { ...s, tags: newTags } : s
      ));
      if (previewSession?.id === session.id) {
        setPreviewSession(prev => prev ? { ...prev, tags: newTags } : null);
      }
    } catch (e) {
      console.error('Failed to update tags:', e);
    }
  };

  const handleTitleChange = async (session: ArchiveSession, newTitle: string) => {
    try {
      if (session._isLocal) {
        await LocalDocumentService.updateTitle(session.id, newTitle);
        if (session._linkedCloudId && user) {
          await DocumentService.updateTitle(user.uid, session._linkedCloudId, newTitle).catch(() => {});
        }
      } else if (user) {
        await DocumentService.updateTitle(user.uid, session.id, newTitle);
      }
      setSessions(prev => prev.map(s =>
        s.id === session.id ? { ...s, title: newTitle } : s
      ));
      if (previewSession?.id === session.id) {
        setPreviewSession(prev => prev ? { ...prev, title: newTitle } : null);
      }
    } catch (e) {
      console.error('Failed to update title:', e);
    }
  };

  const handleDateChange = async (session: ArchiveSession, newDate: Date) => {
    try {
      const ts = newDate.getTime();
      if (session._isLocal) {
        await LocalDocumentService.updateDate(session.id, ts, ts);
        if (session._linkedCloudId && user) {
          await DocumentService.updateDate(user.uid, session._linkedCloudId, newDate, newDate).catch(() => {});
        }
      } else if (user) {
        await DocumentService.updateDate(user.uid, session.id, newDate, newDate);
      }
      setSessions(prev => prev.map(s =>
        s.id === session.id ? { ...s, createdAt: newDate, sessionStartTime: ts } : s
      ));
    } catch (e) {
      console.error('Failed to update date:', e);
    }
  };

  const {
    selectedDate, setSelectedDate,
    selectedMonth, setSelectedMonth,
    selectedTags, setSelectedTags,
    filteredSessions: filteredByFilters
  } = useArchiveFilters(sessions);
  const {
    searchQuery, setSearchQuery,
    searchedSessions: filteredSessions
  } = useArchiveSearch(filteredByFilters);

  const allTags = useMemo(() => Array.from(new Set(sessions.flatMap(s => s.tags || []))), [sessions]);

  const sessionsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    sessions.forEach(s => {
      const d = s.sessionStartTime ? new Date(s.sessionStartTime) : (s.createdAt instanceof Date ? s.createdAt : null);
      if (!d) return;
      const key = format(d, 'yyyy-MM-dd');
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [sessions]);

  const statsTitle = useMemo(() => {
    if (selectedTags.length > 0) {
      return t('archive_stats_by_tag') + ' ' + selectedTags.map(t => '#' + t).join(', ');
    }
    if (selectedMonth) {
      return t('archive_stats_by_month') + ' ' + format(selectedMonth, 'LLLL yyyy', { locale: getDateLocale(language) });
    }
    return t('archive_stats_title');
  }, [selectedTags, selectedMonth, t, language]);

  const hasActiveFilter = selectedTags.length > 0 || !!selectedMonth;

  const resetStatsFilter = () => {
    setSelectedTags([]);
    setSelectedMonth(null);
  };

  const wordCloudSessions = useMemo(
    () => sessions.slice(0, 50),
    [sessions]
  );

  const wordCloud = useMemo(() => {
    const stopWords = new Set(['и','в','на','с','по','что','это','как','из','он','она','они','мы','вы','я','не','но','а','то','же','бы','за','от','до','так','все','при','уже','или','об','для','его','её','их','мне','мой','моя','мои','нет','да','там','тут','где','когда','если','чтобы','который','которая','которые','которых','был','была','были','есть','быть','было']);

    const freq: Record<string, number> = {};
    wordCloudSessions.forEach(s => {
      const snippet = (s.content || '').slice(0, 500).toLowerCase()
        .replace(/[^а-яёa-z\s]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w));
      snippet.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    });

    return Object.entries(freq)
      .sort(([,a],[,b]) => b - a)
      .slice(0, 30)
      .map(([word, count]) => ({ word, count }));
  }, [wordCloudSessions]);

  const maxCount = Math.max(...wordCloud.map(w => w.count), 1);

  const groupedSessions = useMemo(() => {
    return filteredSessions.reduce((acc, session) => {
      const d = session.sessionStartTime ? new Date(session.sessionStartTime) : (session.createdAt instanceof Date ? session.createdAt : null);
      if (!d) return acc;
      const dateKey = format(d, 'yyyy-MM-dd');
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(session);
      return acc;
    }, {} as Record<string, ArchiveSession[]>);
  }, [filteredSessions]);

  const sortedDates = useMemo(() => Object.keys(groupedSessions).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()), [groupedSessions]);

  const dateLocale = getDateLocale(language);

  const entriesLabel = (n: number) =>
    n === 1 ? t('archive_entry_1') :
    n >= 2 && n <= 4 ? t('archive_entry_2') :
    t('archive_entry_5');

  return {
    sessions, loading, error, cloudLoadFailed, fetchSessions,
    handleDeleteSession, handleTagsChange, handleTitleChange, handleDateChange,
    previewSession, setPreviewSession,
    deleteConfirm, setDeleteConfirm,
    allTags, filteredByFilters, filteredSessions,
    searchQuery, setSearchQuery,
    selectedDate, setSelectedDate,
    selectedMonth, setSelectedMonth,
    selectedTags, setSelectedTags,
    statsTitle, hasActiveFilter, resetStatsFilter,
    sessionsByDate, wordCloud, maxCount,
    groupedSessions, sortedDates, dateLocale, entriesLabel,
  };
}
