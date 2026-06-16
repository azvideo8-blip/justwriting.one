import { useState, useEffect, useCallback } from 'react';
import { getLocalDb, getOrCreateGuestId } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { DocumentService } from '../../../core/services/DocumentService';
import { SyncService } from '../../../core/services/SyncService';
import { StorageService } from '../../../core/services/StorageService';
import { AdminUserService } from '../../admin/services/AdminUserService';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { useToast } from '../../../shared/components/Toast';
import { UserProfile } from '../../../types';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

export type Tab = 'stats' | 'sync' | 'db' | 'users' | 'ai_usage' | 'ai_profile';

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
  const [currentAIModel, setCurrentAIModel] = useState<string | null>(null);
  const [modelSwitching, setModelSwitching] = useState(false);

  const [portraitText, setPortraitText] = useState<string | null>(null);
  const [portraitGenerating, setPortraitGenerating] = useState(false);
  const [summaryLogs, setSummaryLogs] = useState<{ id: string; title: string; processedAt: number; tone: string }[]>([]);

  const [stats, setStats] = useState({ localDocs: 0, cloudDocs: 0, aiProcessed: 0, dialogues: 0, summaries: 0, embeddings: 0, customPersonas: 0 });
  const [statsLoaded, setStatsLoaded] = useState(false);

  const [diagnosticsKey, setDiagnosticsKey] = useState(0);
  const [resettingUid, setResettingUid] = useState<string | null>(null);
  const [manualResetUid, setManualResetUid] = useState('');

  const fetchAIConfig = useCallback(async () => {
    try {
      const functions = getFunctions();
      const fn = httpsCallable<Record<string, never>, { model: string }>(functions, 'getAIConfig');
      const { data } = await fn({});
      setCurrentAIModel(data.model);
    } catch (e) {
      console.error('Failed to fetch AI config:', e);
    }
  }, []);

  const switchAIModel = useCallback(async (model: string) => {
    setModelSwitching(true);
    try {
      const functions = getFunctions();
      const fn = httpsCallable<{ model: string }, { success: boolean; model: string }>(functions, 'setAIModel');
      const { data } = await fn({ model });
      setCurrentAIModel(data.model);
      showToast(`Модель переключена на ${data.model.split('/').pop() ?? data.model}`, 'success');
    } catch (e) {
      console.error('Failed to switch AI model:', e);
      showToast('Не удалось переключить модель', 'error');
    } finally {
      setModelSwitching(false);
    }
  }, [showToast]);

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
      console.error('Failed to fetch AI usage:', e);
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
      console.error('Failed to fetch user events:', e);
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
      console.error('Error loading AI Profile data:', e);
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
      setStats({
        localDocs: localDocs.length,
        cloudDocs: localDocs.filter(d => d.linkedCloudId).length,
        aiProcessed: localDocs.filter(d => d.aiProcessed).length,
        dialogues: dialogues.length,
        summaries: summaries.length,
        embeddings: embeddings.length,
        customPersonas: personas.length,
      });
      setStatsLoaded(true);
    } catch (e) {
      console.error('Error loading stats:', e);
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
      console.error(err);
      showToast('Не удалось загрузить данные', 'error');
    } finally {
      setLoadingData(false);
    }
  }, [activeTab, showToast]);

  useEffect(() => {
    if (authLoading) return;
    if (profile?.role === 'admin') {
      void fetchData();
      if (activeTab === 'ai_usage') { void fetchAIUsage(); void fetchAIConfig(); }
      if (activeTab === 'ai_profile') void loadAIProfileData();
      if (activeTab === 'stats') void loadSystemStats();
    }
  }, [activeTab, authLoading, profile, fetchData, fetchAIUsage, fetchAIConfig, loadAIProfileData, loadSystemStats]);

  const handleImportAllFromCloud = async () => {
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
          console.error('Import failed for doc', cloudDoc.id, e);
          failed++;
        }
      }
      showToast(`Импорт завершен: скачано ${imported} из ${cloudDocs.length} заметок. Ошибок: ${failed}`, 'success');
      setDiagnosticsKey(k => k + 1);
    } catch (e) {
      console.error(e);
      showToast('Не удалось импортировать заметки из облака', 'error');
    } finally {
      setBulkImporting(false);
    }
  };

  const handleSyncAllToCloud = async () => {
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
      console.error(e);
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
      console.error('Failed to generate portrait:', e);
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
      console.error('Failed to reset counter:', e);
      const errMsg = e instanceof Error ? e.message : 'Ошибка сервера';
      showToast(`Не удалось сбросить лимит: ${errMsg}`, 'error');
    } finally {
      setResettingUid(null);
    }
  };

  const handleResetUserLimit = async (targetUid: string, displayName: string) => {
    if (!window.confirm(`Сбросить суточный счетчик запросов ИИ для пользователя ${displayName}?`)) return;
    setResettingUid(targetUid);
    try {
      const functions = getFunctions();
      const fn = httpsCallable<{ targetUid: string }, { success: boolean }>(functions, 'resetUserLimit');
      await fn({ targetUid });
      
      // If resetting own limit, clear local too
      const currentUser = getAuth().currentUser;
      if (currentUser && currentUser.uid === targetUid) {
        localStorage.removeItem('ai_daily_usage');
        useAiLimitStore.setState({ used: 0, remaining: useAiLimitStore.getState().limit });
      }
      
      showToast(`Суточный счетчик для ${displayName} успешно сброшен`, 'success');
      await fetchAIUsage();
    } catch (e: unknown) {
      console.error('Failed to reset user limit:', e);
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
    currentAIModel,
    modelSwitching,
    switchAIModel,
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
  };
}
