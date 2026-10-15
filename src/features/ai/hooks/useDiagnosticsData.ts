import { useState, useEffect, useCallback } from 'react';
import { getLocalDb, getOrCreateGuestId } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { DocumentService } from '../../../core/services/DocumentService';
import { SyncService } from '../../../core/services/SyncService';
import { StorageService } from '../../../core/services/StorageService';
import { AdminUserService } from '../../../core/services/AdminUserService';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { AIChatMemoryService } from '../services/AIChatMemoryService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { useToast } from '../../../shared/components/Toast';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { useLanguage } from '../../../shared/i18n';
import { UserProfile, AdminUserItem } from '../../../types';
import { getCurrentUser, sendPasswordResetEmail } from '../../../core/auth';
import { reportError } from '../../../shared/errors/reportError';
import { useAdminStatus } from '../../auth/hooks/useAdminStatus';

import { requestEmbeddingRestore } from '../services/AIRestoreService';
import { callAi } from '../../../core/ai/callAi';
import { isDayLimitError } from '../types/aiErrors';

export type Tab = 'stats' | 'sync' | 'db' | 'users' | 'ai_usage' | 'ai_profile' | 'queue' | 'memory_assembler' | 'beliefs';

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
  const { t } = useLanguage();

  const [loadingData, setLoadingData] = useState(true);
  const [users, setUsers] = useState<AdminUserItem[]>([]);

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
  const [invitingUser, setInvitingUser] = useState(false);
  const [sendingResetEmail, setSendingResetEmail] = useState<string | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);

  const fetchAIUsage = useCallback(async () => {
    setAiUsageLoading(true);
    try {
      if (users.length === 0) {
        const usersData = await AdminUserService.getUsers(ADMIN_AI_USERS_LIMIT);
        setUsers(usersData);
      }
      const data = await callAi<AIUsageResponse>('getAIUsageStats', { date: aiUsageDate });
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
      const data = await callAi<AIEventsResponse>('getAIUsageStats', { date: aiUsageDate, targetUid: uid });
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
        const { portraitCacheKey } = await import('../services/AIProfileService');
        const local = localStorage.getItem(portraitCacheKey(getCurrentUser()?.uid));
        setPortraitText(local);
      }

      const db = await getLocalDb();
      const summaries = await db.getAll('aiSummaries');
      const uid = getCurrentUser()?.uid ?? getOrCreateGuestId();
      const localDocs = await LocalDocumentService.getDocumentsByOwner(uid);

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
      const uid = getCurrentUser()?.uid ?? getOrCreateGuestId();
      const localDocs = await LocalDocumentService.getDocumentsByOwner(uid);
      const db = await getLocalDb();
      // M-4: надгробие (удалённый диалог, который ещё не снят) — не диалог:
      // раньше оно попадало в счётчик и в статистику выхода из аккаунта.
      const dialogueRows = await db.getAll('aiDialogues');
      const dialogues = dialogueRows.filter(d => !d.deletedAt);
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

  const { isAdmin, isStaleToken, error: adminError } = useAdminStatus();

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
      if (isStaleToken && adminError) {
        showToast(adminError, 'error');
      } else {
        showToast('Не удалось загрузить данные администратора. Убедитесь, что сессия активна.', 'error');
      }
    } finally {
      setLoadingData(false);
    }
  }, [activeTab, isStaleToken, adminError, showToast]);

  useEffect(() => {
    if (authLoading) return;
    if (isStaleToken && adminError) {
      showToast(adminError, 'error');
      return;
    }
    if (isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetching when activeTab or admin state changes
      void fetchData();
      if (activeTab === 'ai_usage') { void fetchAIUsage(); }
      if (activeTab === 'ai_profile') void loadAIProfileData();
      if (activeTab === 'stats') void loadSystemStats();
    }
  }, [activeTab, authLoading, isAdmin, isStaleToken, adminError, showToast, fetchData, fetchAIUsage, loadAIProfileData, loadSystemStats]);

  const handleImportAllFromCloud = async () => {
    if (!navigator.onLine) {
      showToast('Данная функция работает только при подключении к сети', 'error');
      return;
    }
    const user = getCurrentUser();
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

  // Deliberately manual — see AIRestoreService: walking the embeddings
  // collection costs more read units than a whole free day.
  const handleRequestEmbeddingRestore = () => {
    const user = getCurrentUser();
    if (!user?.uid) return;
    requestEmbeddingRestore(user.uid);
    showToast('Индекс будет догружаться частями в фоне, по мере дневного лимита чтений', 'success');
  };

  const handleSyncAllToCloud = async () => {
    if (!navigator.onLine) {
      showToast('Данная функция работает только при подключении к сети', 'error');
      return;
    }
    const user = getCurrentUser();
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
      } else if (isDayLimitError(result.error)) {
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
    const user = getCurrentUser();
    if (!user) {
      showToast('Пользователь не авторизован', 'error');
      return;
    }
    setResettingUid(user.uid);
    try {
      await callAi('resetUserLimit', { targetUid: user.uid });
      
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
    const ok = await confirmDialog({
      title: t('admin_clear_memory_confirm_title'),
      message: t('admin_clear_memory_confirm_message'),
    });
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
    try {
      const uid = getCurrentUser()?.uid ?? getOrCreateGuestId();
      const docs = await LocalDocumentService.getDocumentsByOwner(uid);
      const toDeleteCount = await LocalVersionService.countCollapsibleVersions(docs.map(d => d.id));

      const ok = await confirmDialog({
        title: t('admin_collapse_versions_confirm_title', { count: toDeleteCount }),
        message: t('admin_collapse_versions_confirm_message'),
      });
      if (!ok) return;

      let removed = 0;
      let cloudFailures = 0;
      for (const d of docs) {
        const res = await LocalVersionService.collapseToLatest(d.id, uid);
        removed += res.removedCount;
        if (res.cloudError) {
          cloudFailures++;
        }
      }
      if (cloudFailures > 0) {
        showToast(
          t('admin_collapse_versions_partial', { count: removed, failures: cloudFailures }),
          'error',
        );
      } else {
        showToast(t('admin_collapse_versions_done', { count: removed }), 'success');
      }
      await loadSystemStats();
    } catch (e: unknown) {
      reportError(e, { action: 'Failed to collapse versions' });
      showToast(t('admin_collapse_versions_error'), 'error');
    }
  };

  const handleResetUserLimit = async (targetUid: string, displayName: string) => {
    const ok = await confirmDialog({
      title: t('admin_reset_user_limit_confirm_title'),
      message: t('admin_reset_user_limit_confirm_message', { name: displayName }),
      destructive: false,
    });
    if (!ok) return;
    setResettingUid(targetUid);
    try {
      await callAi('resetUserLimit', { targetUid });
      
      // LX-2b: If resetting own limit, clear client state AND sync from server
      // so the client pre-check immediately unblocks (was stuck on stale localStorage).
      const currentUser = getCurrentUser();
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

  const handleInviteUser = async (email: string): Promise<boolean> => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      showToast(t('admin_invite_error', { error: 'Некорректный email' }), 'error');
      return false;
    }
    setInvitingUser(true);
    try {
      const res = await AdminUserService.inviteUser(trimmed);
      if (res?.reinvited) {
        showToast(t('admin_invite_resend_success', { email: trimmed }), 'success');
      } else {
        showToast(t('admin_invite_success', { email: trimmed }), 'success');
      }
      await fetchData();
      return true;
    } catch (e: unknown) {
      const rawMsg = e instanceof Error ? e.message : 'Ошибка сервера';
      let errMsg = rawMsg;
      if (/already been registered/i.test(rawMsg)) {
        errMsg = 'Пользователь с таким email уже зарегистрирован';
      } else if (/invalid email/i.test(rawMsg)) {
        errMsg = 'Некорректный email';
      } else if (/rate limit|too many requests/i.test(rawMsg)) {
        errMsg = 'Слишком много запросов. Попробуй позже.';
      }
      showToast(t('admin_invite_error', { error: errMsg }), 'error');
      return false;
    } finally {
      setInvitingUser(false);
    }
  };

  // 2026-10-05 (owner): удаление чужого аккаунта из админки — сервер удаляет
  // теми же строками, что и самоудаление; себя и админов не даёт.
  const handleDeleteUser = async (user: AdminUserItem) => {
    const label = user.email || user.uid;
    const ok = await confirmDialog({
      title: t('admin_delete_user_confirm_title'),
      message: t('admin_delete_user_confirm_message', { email: label, count: user.noteCount ?? 0 }),
      confirmLabel: t('admin_delete_user_btn'),
      destructive: true,
    });
    if (!ok) return;
    setDeletingUid(user.uid);
    try {
      await AdminUserService.deleteUser(user.uid);
      showToast(t('admin_delete_user_success', { email: label }), 'success');
      setUsers(prev => prev.filter(u => u.uid !== user.uid));
    } catch (e: unknown) {
      reportError(e, { action: 'adminDeleteUser' });
      const errMsg = e instanceof Error ? e.message : 'Ошибка сервера';
      showToast(t('admin_delete_user_error', { error: errMsg }), 'error');
    } finally {
      setDeletingUid(null);
    }
  };

  const handleSendPasswordReset = async (email: string) => {
    if (!email) return;
    setSendingResetEmail(email);
    try {
      await sendPasswordResetEmail(email);
      showToast(t('admin_reset_password_success', { email }), 'success');
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : 'Ошибка сервера';
      showToast(t('admin_reset_password_error', { error: errMsg }), 'error');
    } finally {
      setSendingResetEmail(null);
    }
  };

  return {
    loadingData,
    users,
    invitingUser,
    sendingResetEmail,
    deletingUid,
    handleDeleteUser,
    handleInviteUser,
    handleSendPasswordReset,
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
    handleRequestEmbeddingRestore,
    handleExportProfile,
    handleGeneratePortrait,
    handleResetCounter,
    handleResetUserLimit,
    handleClearMemory,
    handleCollapseVersions,
  };
}
