import { useState, useEffect, useCallback } from 'react';
import { getLocalDb, getOrCreateGuestId } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { DocumentService } from '../../../core/services/DocumentService';
import { SyncService } from '../../../core/services/SyncService';
import { StorageService } from '../../../core/services/StorageService';
import { AdminUserService } from '../../admin/services/AdminUserService';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { AIChatMemoryService } from '../services/AIChatMemoryService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { useToast } from '../../../shared/components/Toast';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { UserProfile } from '../../../types';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { reportError } from '../../../shared/errors/reportError';

export type Tab = 'stats' | 'sync' | 'db' | 'users' | 'ai_usage' | 'ai_profile' | 'queue';

export interface AIUsageRow {
  uid: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
}

export interface AIUsageTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
}

export interface FreeTierLimits {
  requestsPerDay: number;
  tokensPerDay: number;
  requestsPerMinute: number;
  tokensPerMinute: number;
  perUserDaily: number;
}

export interface AIRequestEvent {
  id: string;
  ts: number;
  tokensIn: number;
  tokensOut: number;
  model: string;
  fn: string;
}

type AIUsageResponse = { stats: AIUsageRow[]; totals?: AIUsageTotals; limits?: FreeTierLimits };
type AIEventsResponse = { events: AIRequestEvent[] };

const ADMIN_PAGE_LIMIT = 50;
const ADMIN_AI_USERS_LIMIT = 150;

export function useDiagnosticsData(profile: UserProfile | null, authLoading: boolean, activeTab: Tab) {
  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirmDialog();

  const [loadingData, setLoadingData] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);

  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkSyncing, setBulkSyncing] = useState(false);

  const [aiUsage, setAiUsage] = useState<AIUsageRow[]>([]);
  const [aiTotals, setAiTotals] = useState<AIUsageTotals | null>(null);
  const [aiLimits, setAiLimits] = useState<FreeTierLimits | null>(null);
  const [aiUsageDate, setAiUsageDate] = useState(new Date().toISOString().slice(0, 10));
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  const [aiSearchQuery, setAiSearchQuery] = useState('');
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [userEvents, setUserEvents] = useState<AIRequestEvent[]>([]);
  const [userEventsLoading, setUserEventsLoading] = useState(false);
  const [portraitText, setPortraitText] = useState<string | null>(null);
  const [portraitGenerating, setPortraitGenerating] = useState(false);
  const [summaryLogs, setSummaryLogs] = useState<{ id: string; title: string; processedAt: number; tone: string }[]>([]);

  const [stats, setStats] = useState({ localDocs: 0, cloudDocs: 0, aiProcessed: 0, dialogues: 0, summaries: 0, embeddings: 0, customPersonas: 0, memories: 0 });
  const [statsLoaded, setStatsLoaded] = useState(false);

  const [diagnosticsKey, setDiagnosticsKey] = useState(0);
  const [resettingUid, setResettingUid] = useState<string | null>(null);
  const [manualResetUid, setManualResetUid] = useState('');

  const fetchAIUsage = useCallback(async () => {
    setAiUsageLoading(true);
    try {
      if (users.length === 0) {
        const usersData = await AdminUserService.getUsers(ADMIN_AI_USERS_LIMIT);
        setUsers(usersData);
      }
      const functions = getFunctions();
      const fn = httpsCallable<{ date: string }, AIUsageResponse>(functions, 'getAIUsageStats');
      const { data } = await fn({ date: aiUsageDate });
      setAiUsage(data.stats);
      setAiTotals(data.totals ?? null);
      setAiLimits(data.limits ?? null);
      setExpandedUid(null);
      setUserEvents([]);
    } catch (e) {
      reportError(e, { action: 'Failed to fetch AI usage' });
      showToast('Не удалось загрузить статистику AI', 'error');
    } finally {
      setAiUsageLoading(false);
    }
  }, [aiUsageDate, users.length, showToast]);

  const fetchUserEvents = useCallback(async (uid: string) => {
    if (expandedUid === uid) {
      setExpandedUid(null);
      setUserEvents([]);
      return;
    }
    setExpandedUid(uid);
    setUserEventsLoading(true);
    setUserEvents([]);
    try {
      const functions = getFunctions();
      const fn = httpsCallable<{ date: string; targetUid: string }, AIEventsResponse>(functions, 'getAIUsageStats');
      const { data } = await fn({ date: aiUsageDate, targetUid: uid });
      setUserEvents(data.events ?? []);
    } catch (e) {
      reportError(e, { action: 'Failed to fetch user events' });
      showToast('Не удалось загрузить события пользователя', 'error');
      setExpandedUid(null);
    } finally {
      setUserEventsLoading(false);
    }
  }, [expandedUid, aiUsageDate, showToast]);

  const loadAIProfileData = useCallback(async () => {
    try {
      try {
        const { AIProfileService } = await import('../services/AIProfileService');
        const portrait = await AIProfileService.getPortrait();
        setPortraitText(portrait);
      } catch {
        const local = localStorage.getItem('ai_user_portrait');
        setPortraitText(local);
      }

      const db = await getLocalDb();
      const summaries = await db.getAll('aiSummaries');
      const uid = getAuth().currentUser?.uid ?? getOrCreateGuestId();
      const localDocs = await LocalDocumentService.getGuestDocuments(uid);

      const logs = summaries.map(s => {
        const doc = localDocs.find(d => d.id === s.documentId);
        return {
          id: s.documentId,
          title: doc?.title ?? '(без названия)',
          processedAt: s.processedAt,
          tone: s.tone,
        };
      });
      logs.sort((a, b) => b.processedAt - a.processedAt);
      setSummaryLogs(logs);
    } catch (e) {
      reportError(e, { action: 'Error loading AI Profile data' });
    }
  }, []);

  const loadSystemStats = useCallback(async () => {
    try {
      const uid = getAuth().currentUser?.uid ?? getOrCreateGuestId();
      const localDocs = await LocalDocumentService.getGuestDocuments(uid);
      const db = await getLocalDb();
      const dialogues = await db.getAll('aiDialogues');
      const summaries = await db.getAll('aiSummaries');
      const embeddings = await db.getAll('aiEmbeddings');
      const personas = await db.getAll('aiPersonas');
      const memories = await db.getAll('aiChatMemory');
      setStats({
        localDocs: localDocs.length,
        cloudDocs: localDocs.filter(d => d.linkedCloudId).length,
        aiProcessed: localDocs.filter(d => d.aiProcessed).length,
        dialogues: dialogues.length,
        summaries: summaries.length,
        embeddings: embeddings.length,
        customPersonas: personas.length,
        memories: memories.length,
      });
      setStatsLoaded(true);
    } catch (e) {
      reportError(e, { action: 'Error loading stats' });
      setStatsLoaded(true);
    }
  }, []);

  const fetchData = useCallback(async () => {
    if (activeTab !== 'users') {
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    try {
      const usersData = await AdminUserService.getUsers(ADMIN_PAGE_LIMIT);
      setUsers(usersData);
    } catch (err) {
      reportError(err);
      showToast('Не удалось загрузить данные', 'error');
    } finally {
      setLoadingData(false);
    }
  }, [activeTab, showToast]);

  useEffect(() => {
    if (authLoading) return;
    if (profile?.role === 'admin') {
      void fetchData();
      if (activeTab === 'ai_usage') { void fetchAIUsage(); }
      if (activeTab === 'ai_profile') void loadAIProfileData();
      if (activeTab === 'stats') void loadSystemStats();
    }
  }, [activeTab, authLoading, profile, fetchData, fetchAIUsage, loadAIProfileData, loadSystemStats]);

  const handleImportAllFromCloud = async () => {
    if (!navigator.onLine) {
      showToast('Данная функция работает только при подключении к сети', 'error');
      return;
    }
    const user = getAuth().currentUser;
    if (!user) return;
    setBulkImporting(true);
    try {
      const cloudDocs = await DocumentService.getUserDocuments(user.uid);
      let imported = 0;
      let failed = 0;
      for (const cloudDoc of cloudDocs) {
        try {
          await StorageService.addLocalCopy(user.uid, cloudDoc.id);
          imported++;
        } catch (e) {
          reportError(e, { action: 'Import failed for doc', docId: cloudDoc.id });
          failed++;
        }
      }
      showToast(`Импорт завершен: скачано ${imported} из ${cloudDocs.length} заметок. Ошибок: ${failed}`, 'success');
      setDiagnosticsKey(k => k + 1);
    } catch (e) {
      reportError(e);
      showToast('Не удалось импортировать заметки из облака', 'error');
    } finally {
      setBulkImporting(false);
    }
  };

  const handleSyncAllToCloud = async () => {
    if (!navigator.onLine) {
      showToast('Данная функция работает только при подключении к сети', 'error');
      return;
    }
    const user = getAuth().currentUser;
    if (!user) return;
    setBulkSyncing(true);
    try {
      const result = await SyncService.syncAllUnlinked(user.uid);
      if (result.failed > 0) {
        showToast(`Синхронизация завершена с ошибками: не удалось выгрузить ${result.failed} заметок`, 'error');
      } else {
        showToast('Все локальные заметки выгружены в облако', 'success');
      }
      setDiagnosticsKey(k => k + 1);
    } catch (e) {
      reportError(e);
      showToast('Не удалось выгрузить заметки в облако', 'error');
    } finally {
      setBulkSyncing(false);
    }
  };

  const handleExportProfile = async () => {
    const { AIProfileService } = await import('../services/AIProfileService');
    const result = await AIProfileService.exportMarkdown();
    if (!result) showToast('Портрет ещё не создан', 'error');
  };

  const handleGeneratePortrait = async () => {
    if (!navigator.onLine) {
      showToast('Данная функция работает только при подключении к сети', 'error');
      return;
    }
    setPortraitGenerating(true);
    try {
      const { AIProfileService } = await import('../services/AIProfileService');
      const result = await AIProfileService.generate();
      if (result.ok) {
        setPortraitText(result.markdown);
        showToast('Психологический портрет обновлён', 'success');
      } else if (result.error === 'NOT_ENOUGH_DATA') {
        showToast('Нужно минимум 3 проанализированных заметки', 'error');
      } else if (result.error === 'DAILY_LIMIT') {
        showToast('Достигнут дневной лимит ИИ — сбросьте счётчик и попробуйте снова', 'error');
      } else {
        showToast(`Не удалось создать портрет: ${result.error}`, 'error');
      }
    } catch (e) {
      reportError(e, { action: 'Failed to generate portrait' });
      showToast('Ошибка при создании портрета', 'error');
    } finally {
      setPortraitGenerating(false);
    }
  };

  const handleResetCounter = async () => {
    const user = getAuth().currentUser;
    if (!user) {
      showToast('Пользователь не авторизован', 'error');
      return;
    }
    setResettingUid(user.uid);
    try {
      const functions = getFunctions();
      const fn = httpsCallable<{ targetUid: string }, { success: boolean }>(functions, 'resetUserLimit');
      await fn({ targetUid: user.uid });
      
      localStorage.removeItem('ai_daily_usage');
      useAiLimitStore.setState({ used: 0, remaining: useAiLimitStore.getState().limit });
      showToast('Счетчик использования AI сброшен в БД и локально', 'success');
    } catch (e: unknown) {
      reportError(e, { action: 'Failed to reset counter' });
      const errMsg = e instanceof Error ? e.message : 'Ошибка сервера';
      showToast(`Не удалось сбросить лимит: ${errMsg}`, 'error');
    } finally {
      setResettingUid(null);
    }
  };

  const handleClearMemory = async () => {
    const ok = await confirmDialog({ title: 'Очистить память ИИ?', message: 'Накопленные факты/инсайты будут удалены безвозвратно. Диалоги и заметки не затрагиваются.' });
    if (!ok) return;
    try {
      await AIChatMemoryService.deleteAll();
      showToast('Память ИИ очищена', 'success');
      await loadSystemStats();
    } catch (e: unknown) {
      reportError(e, { action: 'Failed to clear AI memory' });
      showToast('Не удалось очистить память ИИ', 'error');
    }
  };

  const handleCollapseVersions = async () => {
    const ok = await confirmDialog({ title: 'Схлопнуть версии?', message: 'Оставить только последнюю версию у каждой заметки. Текст не меняется, удаляются лишь старые снимки. Действие необратимо.' });
    if (!ok) return;
    try {
      const uid = getAuth().currentUser?.uid ?? getOrCreateGuestId();
      const docs = await LocalDocumentService.getGuestDocuments(uid);
      let removed = 0;
      for (const d of docs) {
        removed += await LocalVersionService.collapseToLatest(d.id);
      }
      showToast(`Готово: удалено старых версий — ${removed}`, 'success');
      await loadSystemStats();
    } catch (e: unknown) {
      reportError(e, { action: 'Failed to collapse versions' });
      showToast('Не удалось схлопнуть версии', 'error');
    }
  };

  const handleResetUserLimit = async (targetUid: string, displayName: string) => {
    const ok = await confirmDialog({ title: 'Сбросить лимит?', message: `Сбросить суточный счетчик запросов ИИ для пользователя ${displayName}?`, destructive: false });
    if (!ok) return;
    setResettingUid(targetUid);
    try {
      const functions = getFunctions();
      const fn = httpsCallable<{ targetUid: string }, { success: boolean }>(functions, 'resetUserLimit');
      await fn({ targetUid });
      
      // LX-2b: If resetting own limit, clear client state AND sync from server
      // so the client pre-check immediately unblocks (was stuck on stale localStorage).
      const currentUser = getAuth().currentUser;
      if (currentUser && currentUser.uid === targetUid) {
        localStorage.removeItem('ai_daily_usage');
        useAiLimitStore.setState({ used: 0, remaining: useAiLimitStore.getState().limit, loaded: false });
        void useAiLimitStore.getState().loadLimitFromServer();
      }
      
      showToast(`Суточный счетчик для ${displayName} успешно сброшен`, 'success');
      await fetchAIUsage();
    } catch (e: unknown) {
      reportError(e, { action: 'Failed to reset user limit' });
      const errMsg = e instanceof Error ? e.message : 'Ошибка сервера';
      showToast(`Не удалось сбросить лимит: ${errMsg}`, 'error');
    } finally {
      setResettingUid(null);
    }
  };

  return {
    loadingData,
    users,
    bulkImporting,
    bulkSyncing,
    aiUsage,
    aiTotals,
    aiLimits,
    aiUsageDate,
    setAiUsageDate,
    aiUsageLoading,
    aiSearchQuery,
    setAiSearchQuery,
    expandedUid,
    userEvents,
    userEventsLoading,
    fetchUserEvents,
    portraitText,
    portraitGenerating,
    summaryLogs,
    stats,
    statsLoaded,
    diagnosticsKey,
    resettingUid,
    manualResetUid,
    setManualResetUid,
    fetchAIUsage,
    handleImportAllFromCloud,
    handleSyncAllToCloud,
    handleExportProfile,
    handleGeneratePortrait,
    handleResetCounter,
    handleResetUserLimit,
    handleClearMemory,
    handleCollapseVersions,
  };
}
