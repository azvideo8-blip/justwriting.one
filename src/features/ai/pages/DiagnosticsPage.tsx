import React, { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { 
  Download, X, RotateCcw, Bug, Database, 
  RefreshCw, Trash2, Loader2, Upload 
} from 'lucide-react';
import { getLocalDb, getOrCreateGuestId } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { DocumentService } from '../../../core/services/DocumentService';
import { SyncService } from '../../../core/services/SyncService';
import { StorageService } from '../../../core/services/StorageService';
import { VersionService } from '../../../core/services/VersionService';
import { AdminUserService } from '../../admin/services/AdminUserService';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { useDailyLimit } from '../hooks/useDailyLimit';
import { cn } from '../../../core/utils/utils';
import { APP_VERSION } from '../../../version';
import { SyncDiagnostics } from '../../settings/components/SyncDiagnostics';
import { AdminUsersTable } from '../../admin/components/AdminUsersTable';
import { LoadingSpinner } from '../../../shared/components/LoadingSpinner';
import { UserProfile } from '../../../types';
import { useToast } from '../../../shared/components/Toast';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

type Tab = 'stats' | 'sync' | 'db' | 'users' | 'ai_usage' | 'ai_profile';

interface AIUsageRow {
  uid: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
}

const ADMIN_PAGE_LIMIT = 50;
const ADMIN_AI_USERS_LIMIT = 150;

export function DiagnosticsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { profile, loading: authLoading } = useAuthStatus();
  const dailyLimit = useDailyLimit();

  // Navigation & Tabs
  const [activeTab, setActiveTab] = useState<Tab>('sync');
  
  // Data loading states
  const [loadingData, setLoadingData] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  
  // Bulk operations
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  
  // AI Usage tab states
  const [aiUsage, setAiUsage] = useState<AIUsageRow[]>([]);
  const [aiUsageDate, setAiUsageDate] = useState(new Date().toISOString().slice(0, 10));
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  const [aiSearchQuery, setAiSearchQuery] = useState('');

  // AI Profile tab states
  const [portraitText, setPortraitText] = useState<string | null>(null);
  const [summaryLogs, setSummaryLogs] = useState<{ id: string; title: string; processedAt: number; tone: string }[]>([]);

  // Statistics tab states
  const [stats, setStats] = useState({ localDocs: 0, cloudDocs: 0, aiProcessed: 0, dialogues: 0, summaries: 0, customPersonas: 0 });
  const [statsLoaded, setStatsLoaded] = useState(false);

  // Reference to force diagnostic component reload
  const [diagnosticsKey, setDiagnosticsKey] = useState(0);

  const fetchAIUsage = useCallback(async () => {
    setAiUsageLoading(true);
    try {
      if (users.length === 0) {
        const usersData = await AdminUserService.getUsers(ADMIN_AI_USERS_LIMIT);
        setUsers(usersData);
      }
      const functions = getFunctions();
      const fn = httpsCallable<{ date: string }, { stats: AIUsageRow[] }>(functions, 'getAIUsageStats');
      const { data } = await fn({ date: aiUsageDate });
      setAiUsage(data.stats);
    } catch (e) {
      console.error('Failed to fetch AI usage:', e);
      showToast('Не удалось загрузить статистику AI', 'error');
    } finally {
      setAiUsageLoading(false);
    }
  }, [aiUsageDate, users.length, showToast]);

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
      const personas = await db.getAll('aiPersonas');
      setStats({
        localDocs: localDocs.length,
        cloudDocs: localDocs.filter(d => d.linkedCloudId).length,
        aiProcessed: localDocs.filter(d => d.aiProcessed).length,
        dialogues: dialogues.length,
        summaries: summaries.length,
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
      fetchData();
      if (activeTab === 'ai_usage') fetchAIUsage();
      if (activeTab === 'ai_profile') loadAIProfileData();
      if (activeTab === 'stats') loadSystemStats();
    }
  }, [activeTab, authLoading, profile, fetchData, fetchAIUsage, loadAIProfileData, loadSystemStats]);

  // Bulk Operations
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
      setDiagnosticsKey(k => k + 1); // Refresh diagnostics tables
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
      setDiagnosticsKey(k => k + 1); // Refresh diagnostics tables
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

  const handleResetCounter = () => {
    localStorage.removeItem('ai_daily_usage');
    useAiLimitStore.setState({ used: 0, remaining: useAiLimitStore.getState().limit });
    showToast('Счетчик использования AI сброшен', 'success');
  };

  if (authLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size={10} />
      </div>
    );
  }

  if (profile?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-surface-base p-6 max-w-5xl mx-auto space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-3 text-text-main">
          <Bug className="text-red-400" />
          Диагностика и администрирование
        </h2>
        <button 
          onClick={() => navigate('/')} 
          className="p-2 rounded-lg text-text-main/40 hover:text-text-main hover:bg-surface-base/10 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* Tabs list */}
      <div className="flex flex-wrap gap-1 p-1 bg-surface-card/40 border border-border-subtle rounded-2xl w-fit">
        <button
          onClick={() => setActiveTab('sync')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200",
            activeTab === 'sync' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
          )}
        >
          Синхронизация
        </button>
        <button
          onClick={() => setActiveTab('db')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200",
            activeTab === 'db' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
          )}
        >
          База данных
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200",
            activeTab === 'users' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
          )}
        >
          Пользователи
        </button>
        <button
          onClick={() => setActiveTab('ai_usage')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200",
            activeTab === 'ai_usage' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
          )}
        >
          Статистика AI
        </button>
        <button
          onClick={() => setActiveTab('ai_profile')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200",
            activeTab === 'ai_profile' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
          )}
        >
          Профиль AI
        </button>
        <button
          onClick={() => setActiveTab('stats')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200",
            activeTab === 'stats' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
          )}
        >
          Система
        </button>
      </div>

      {/* Tab Panels */}
      <div className="bg-surface-card border border-border-subtle rounded-3xl p-6 shadow-sm min-h-[400px]">
        
        {/* Tab 1: Sync */}
        {activeTab === 'sync' && (
          <div className="space-y-6">
            {/* Bulk Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-5 rounded-2xl border border-border-subtle bg-surface-base/5 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-text-main">Выгрузка всех данных</h3>
                  <p className="text-xs text-text-main/40 mt-1">Отправляет все локальные несинхронизированные заметки в Cloud Firestore.</p>
                </div>
                <button
                  onClick={handleSyncAllToCloud}
                  disabled={bulkSyncing}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-text-main text-surface-base text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-colors min-h-[38px]"
                >
                  {bulkSyncing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  Загрузить всё в облако
                </button>
              </div>

              <div className="p-5 rounded-2xl border border-border-subtle bg-surface-base/5 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-text-main">Импорт из облака</h3>
                  <p className="text-xs text-text-main/40 mt-1">Скачивает все резервные копии заметок из облака в локальный кэш IndexedDB.</p>
                </div>
                <button
                  onClick={handleImportAllFromCloud}
                  disabled={bulkImporting}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-text-main text-surface-base text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-colors min-h-[38px]"
                >
                  {bulkImporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  Скачать всё из облака
                </button>
              </div>
            </div>

            <div className="border-t border-border-subtle pt-6">
              <h3 className="text-sm font-semibold text-text-main mb-3">Детальное сопоставление (Диагностика синхронизации)</h3>
              <SyncDiagnostics key={diagnosticsKey} userId={profile.uid} />
            </div>
          </div>
        )}

        {/* Tab 2: Database Explorer */}
        {activeTab === 'db' && (
          <DatabaseExplorer userId={profile.uid} />
        )}

        {/* Tab 3: Users */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-text-main mb-3">Зарегистрированные пользователи</h3>
            {loadingData ? (
              <div className="flex justify-center py-10"><LoadingSpinner size={8} /></div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-border-subtle">
                <AdminUsersTable users={users} />
              </div>
            )}
          </div>
        )}

        {/* Tab 5: AI Stats */}
        {activeTab === 'ai_usage' && (() => {
          const COST_IN = 0.000000075;
          const COST_OUT = 0.00000030;
          const q = aiSearchQuery.toLowerCase();
          const filtered = q
            ? aiUsage.filter(row => {
                const uProfile = users.find(u => u.uid === row.uid);
                const email = uProfile?.email?.toLowerCase() ?? '';
                const nick = uProfile?.nickname?.toLowerCase() ?? '';
                return row.uid.toLowerCase().includes(q) || email.includes(q) || nick.includes(q);
              })
            : aiUsage;
          const totalCost = filtered.reduce((s, r) => s + r.promptTokens * COST_IN + r.completionTokens * COST_OUT, 0);
          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h3 className="text-sm font-semibold text-text-main">Использование Gemini API</h3>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={aiUsageDate}
                    onChange={e => setAiUsageDate(e.target.value)}
                    className="px-3 py-1.5 rounded-xl bg-surface-base/5 border border-border-subtle text-xs text-text-main outline-none"
                  />
                  <button
                    onClick={fetchAIUsage}
                    disabled={aiUsageLoading}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-text-main text-surface-base text-xs font-semibold disabled:opacity-50 transition-colors"
                  >
                    {aiUsageLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    Обновить
                  </button>
                </div>
              </div>

              <input
                type="text"
                value={aiSearchQuery}
                onChange={e => setAiSearchQuery(e.target.value)}
                placeholder="Поиск по email / никнейму / uid..."
                className="w-full px-4 py-2.5 text-xs rounded-xl bg-surface-base/5 border border-border-subtle text-text-main placeholder:text-text-main/30 outline-none focus:border-brand-soft/30"
              />

              <div className="overflow-x-auto rounded-2xl border border-border-subtle bg-surface-card/10">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b bg-surface-base/5 border-border-subtle text-text-main/50 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Пользователь</th>
                      <th className="py-3 px-4 text-right">Запросы</th>
                      <th className="py-3 px-4 text-right">Tokens In</th>
                      <th className="py-3 px-4 text-right">Tokens Out</th>
                      <th className="py-3 px-4 text-right">Итого токенов</th>
                      <th className="py-3 px-4 text-right">Стоимость (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(row => {
                      const uProfile = users.find(u => u.uid === row.uid);
                      const displayName = uProfile
                        ? `${uProfile.nickname ?? ''} (${uProfile.email ?? ''})`
                        : row.uid.slice(0, 8) + '...';
                      const cost = row.promptTokens * COST_IN + row.completionTokens * COST_OUT;
                      return (
                        <tr key={row.uid} className="border-b border-border-subtle/40 last:border-0 hover:bg-text-main/[0.01]">
                          <td className="py-2.5 px-4 text-text-main/80 font-medium" title={row.uid}>{displayName}</td>
                          <td className="py-2.5 px-4 text-right text-text-main/60">{row.requests}</td>
                          <td className="py-2.5 px-4 text-right text-text-main/60">{row.promptTokens.toLocaleString()}</td>
                          <td className="py-2.5 px-4 text-right text-text-main/60">{row.completionTokens.toLocaleString()}</td>
                          <td className="py-2.5 px-4 text-right text-text-main/60">{(row.promptTokens + row.completionTokens).toLocaleString()}</td>
                          <td className="py-2.5 px-4 text-right text-text-main/80 font-mono">${cost.toFixed(5)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {filtered.length > 0 && (
                    <tfoot>
                      <tr className="border-t bg-surface-base/5 border-border-subtle font-bold text-text-main">
                        <td className="py-3 px-4">Итого</td>
                        <td className="py-3 px-4 text-right">{filtered.reduce((s, r) => s + r.requests, 0)}</td>
                        <td className="py-3 px-4 text-right">{filtered.reduce((s, r) => s + r.promptTokens, 0).toLocaleString()}</td>
                        <td className="py-3 px-4 text-right">{filtered.reduce((s, r) => s + r.completionTokens, 0).toLocaleString()}</td>
                        <td className="py-3 px-4 text-right">{filtered.reduce((s, r) => s + r.promptTokens + r.completionTokens, 0).toLocaleString()}</td>
                        <td className="py-3 px-4 text-right font-mono">${totalCost.toFixed(5)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {aiUsage.length === 0 && !aiUsageLoading && (
                <div className="py-12 text-center text-xs text-text-main/25">Нет данных об AI-активности за выбранную дату</div>
              )}
            </div>
          );
        })()}

        {/* Tab 6: AI Profile */}
        {activeTab === 'ai_profile' && (
          <div className="space-y-6">
            <h3 className="text-sm font-semibold text-text-main mb-3">Профиль автора & AI логи</h3>
            
            {portraitText !== null && (
              <div className="rounded-2xl bg-surface-base/5 border border-border-subtle overflow-hidden">
                <div className="px-5 py-3 border-b border-border-subtle flex items-center justify-between">
                  <span className="text-xs font-bold text-text-main/50 uppercase tracking-wider">Психологический портрет пользователя</span>
                  <button
                    onClick={handleExportProfile}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-brand-soft/20 bg-brand-soft/10 text-brand-soft text-[10px] font-bold"
                  >
                    <Download size={12} />
                    Экспорт .md
                  </button>
                </div>
                <div className="px-5 py-4 max-h-60 overflow-y-auto text-xs text-text-main/60 whitespace-pre-wrap leading-relaxed">
                  {portraitText || <span className="italic text-text-main/25">Портрет ещё не создан</span>}
                </div>
              </div>
            )}

            {summaryLogs.length > 0 && (
              <div className="rounded-2xl border border-border-subtle overflow-hidden">
                <div className="px-5 py-3 border-b border-border-subtle bg-surface-base/5">
                  <span className="text-xs font-bold text-text-main/50 uppercase tracking-wider">История обработки заметок ИИ</span>
                </div>
                <div className="divide-y divide-border-subtle/50 text-xs">
                  {summaryLogs.map(log => (
                    <div key={log.id} className="px-5 py-3 flex items-center gap-3 hover:bg-text-main/[0.01]">
                      <span className="text-[10px] font-mono text-text-main/30">{new Date(log.processedAt).toLocaleString('ru-RU')}</span>
                      <span className="text-xs text-text-main/70 truncate flex-1 font-medium">«{log.title}»</span>
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-brand-soft/10 text-brand-soft">{log.tone}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2">
              <button
                onClick={handleResetCounter}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition-colors"
              >
                <RotateCcw size={13} />
                Сбросить суточный счетчик ИИ
              </button>
            </div>
          </div>
        )}

        {/* Tab 7: Stats */}
        {activeTab === 'stats' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-text-main mb-3">Системные метрики</h3>
            {!statsLoaded ? (
              <div className="flex justify-center py-10"><LoadingSpinner size={8} /></div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { label: 'Версия приложения', value: APP_VERSION },
                  { label: 'Локальная база (IndexedDB) версия', value: '5' },
                  { label: 'Локальных документов на устройстве', value: stats.localDocs },
                  { label: 'Документов в облаке (Firestore)', value: stats.cloudDocs },
                  { label: 'Только на этом устройстве (local only)', value: stats.localDocs - stats.cloudDocs },
                  { label: 'Саммари ИИ сохранено', value: stats.summaries },
                  { label: 'Диалогов ИИ записано', value: stats.dialogues },
                  { label: 'Кастомных персон создано', value: stats.customPersonas },
                  { label: 'Лимит ИИ за сутки', value: `${dailyLimit.used} / ${dailyLimit.limit} запросов` }
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between p-4 rounded-xl border border-border-subtle bg-surface-base/5">
                    <span className="text-xs text-text-main/50 font-medium">{r.label}</span>
                    <span className="text-xs font-mono font-bold text-text-main">{r.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>


    </div>
  );
}

// Database Explorer Component Constants
const LOCAL_TABLES = [
  { name: 'documents', label: 'documents (Заметки)' },
  { name: 'versions', label: 'versions (Версии)' },
  { name: 'aiSummaries', label: 'aiSummaries (AI Саммари)' },
  { name: 'aiDialogues', label: 'aiDialogues (AI Диалоги)' },
  { name: 'aiPersonas', label: 'aiPersonas (AI Персоны)' },
  { name: 'syncQueue', label: 'syncQueue (Очередь выгрузки)' },
  { name: 'drafts', label: 'drafts (Черновики)' },
  { name: 'pending_sessions', label: 'pending_sessions (Неотправленные)' },
  { name: 'profile', label: 'profile (Локальный профиль)' },
];

const FIRESTORE_TABLES = [
  { name: 'users', label: 'users (Профили Firestore)' },
  { name: 'user_documents', label: 'documents (Мои доки Cloud)' },
  { name: 'user_versions', label: 'versions (Мои версии Cloud)' },
];

interface DatabaseExplorerProps {
  userId: string;
}

type DBSource = 'local' | 'firestore';
type RecordType = Record<string, unknown>;

function DatabaseExplorer({ userId }: DatabaseExplorerProps) {
  const [source, setSource] = useState<DBSource>('local');
  const [selectedTable, setSelectedTable] = useState<string>('documents');
  const [records, setRecords] = useState<RecordType[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<RecordType | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { showToast } = useToast();

  const tables = source === 'local' ? LOCAL_TABLES : FIRESTORE_TABLES;

  useEffect(() => {
    if (source === 'local') {
      if (!LOCAL_TABLES.some(t => t.name === selectedTable)) {
        setSelectedTable('documents');
      }
    } else {
      if (!FIRESTORE_TABLES.some(t => t.name === selectedTable)) {
        setSelectedTable('users');
      }
    }
    setSelectedRecord(null);
  }, [source, selectedTable]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (source === 'local') {
        const db = await getLocalDb();
        const data = await db.getAll(selectedTable as 'documents'); // Cast to avoid typed stores TS check
        setRecords(data as unknown as RecordType[]);
      } else {
        if (selectedTable === 'users') {
          const data = await AdminUserService.getUsers(150);
          setRecords(data as unknown as RecordType[]);
        } else if (selectedTable === 'user_documents') {
          const data = await DocumentService.getUserDocuments(userId);
          setRecords(data as unknown as RecordType[]);
        } else if (selectedTable === 'user_versions') {
          const docs = await DocumentService.getUserDocuments(userId);
          const allVersions: RecordType[] = [];
          for (const doc of docs) {
            const vers = await VersionService.getVersions(userId, doc.id);
            allVersions.push(...vers.map(v => ({ ...v, docTitle: doc.title } as unknown as RecordType)));
          }
          setRecords(allVersions);
        }
      }
    } catch (e) {
      console.error(e);
      showToast('Не удалось загрузить данные таблиц', 'error');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [source, selectedTable, userId, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDeleteRecord = async (record: RecordType) => {
    if (!window.confirm('Вы уверены, что хотите безвозвратно удалить эту запись из базы данных?')) return;
    try {
      if (source === 'local') {
        const db = await getLocalDb();
        let key: string | number = record.id as string;
        if (selectedTable === 'aiSummaries') key = record.documentId as string;
        if (selectedTable === 'profile') key = record.guestId as string;
        if (selectedTable === 'drafts') key = record.userId as string;
        if (selectedTable === 'pending_sessions') key = record.id as number;
        
        const looseDb = db as unknown as { delete: (store: string, key: string | number) => Promise<void> };
        await looseDb.delete(selectedTable, key);
        showToast('Запись удалена из IndexedDB', 'success');
      } else {
        if (selectedTable === 'user_documents') {
          await DocumentService.deleteDocument(userId, record.id as string);
          showToast('Документ удален из Firestore', 'success');
        } else {
          showToast('Удаление для этой коллекции не поддерживается клиентом', 'error');
          return;
        }
      }
      setSelectedRecord(null);
      loadData();
    } catch (e) {
      console.error(e);
      showToast('Ошибка при удалении записи', 'error');
    }
  };

  const filteredRecords = records.filter(r => {
    const query = searchQuery.toLowerCase();
    if (!query) return true;
    try {
      const jsonStr = JSON.stringify(r).toLowerCase();
      return jsonStr.includes(query);
    } catch {
      return false;
    }
  });

  const getRecordTitle = (r: RecordType) => {
    if (!r) return 'Пустая запись';
    
    const id = typeof r.id === 'string' ? r.id : typeof r.id === 'number' ? String(r.id) : '';
    const title = typeof r.title === 'string' ? r.title : '';
    const documentId = typeof r.documentId === 'string' ? r.documentId : '';
    const nickname = typeof r.nickname === 'string' ? r.nickname : '';
    const email = typeof r.email === 'string' ? r.email : '';
    const docTitle = typeof r.docTitle === 'string' ? r.docTitle : '';
    const version = typeof r.version === 'number' || typeof r.version === 'string' ? String(r.version) : '';
    const tone = typeof r.tone === 'string' ? r.tone : '';
    const name = typeof r.name === 'string' ? r.name : '';
    const emoji = typeof r.emoji === 'string' ? r.emoji : '';
    const type = typeof r.type === 'string' ? r.type : '';
    const personaName = typeof r.personaName === 'string' ? r.personaName : '';

    if (selectedTable === 'users') {
      return `${nickname || 'Пользователь'} (${email || 'Без почты'})`;
    }
    if (selectedTable === 'documents' || selectedTable === 'user_documents') {
      return title || `Заметка ${id.slice(0, 8) || 'без ID'}`;
    }
    if (selectedTable === 'versions' || selectedTable === 'user_versions') {
      return `${docTitle || documentId.slice(0, 8) || 'Без названия'} - v${version || '?'}`;
    }
    if (selectedTable === 'aiSummaries') {
      return `Саммари: ${documentId.slice(0, 8) || 'без ID'} (${tone || 'без тона'})`;
    }
    if (selectedTable === 'aiDialogues') {
      return title || `Диалог: ${personaName || 'без имени'}`;
    }
    if (selectedTable === 'aiPersonas') {
      return `${emoji || '👤'} ${name || 'Персонаж'}`;
    }
    if (selectedTable === 'syncQueue') {
      return `Очередь: ${type || 'запись'} ${documentId.slice(0, 8) || 'без ID'}`;
    }
    if (selectedTable === 'drafts') {
      return `Черновик: ${title || 'Без названия'}`;
    }
    
    // Fallback for custom or unknown tables
    if (id) return id;
    try {
      return JSON.stringify(r).slice(0, 30);
    } catch {
      return 'Запись';
    }
  };

  const getRecordId = (r: RecordType) => {
    if (!r) return 'Нет ID';
    const id = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id) : '';
    const documentId = typeof r.documentId === 'string' ? r.documentId : '';
    const guestId = typeof r.guestId === 'string' ? r.guestId : '';
    const userId = typeof r.userId === 'string' ? r.userId : '';
    return id || documentId || guestId || userId || 'Нет ID';
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 min-h-[500px]">
      
      {/* Left Column */}
      <div className="w-full md:w-1/3 space-y-4">
        
        {/* Source Switcher */}
        <div className="flex gap-1 p-1 bg-surface-base/10 rounded-xl border border-border-subtle text-[11px] font-bold">
          <button
            onClick={() => setSource('local')}
            className={cn(
              "flex-1 py-1.5 rounded-lg transition-all duration-200",
              source === 'local' ? "bg-surface-base/20 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
            )}
          >
            Локальная БД (IndexedDB)
          </button>
          <button
            onClick={() => setSource('firestore')}
            className={cn(
              "flex-1 py-1.5 rounded-lg transition-all duration-200",
              source === 'firestore' ? "bg-surface-base/20 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
            )}
          >
            Firestore
          </button>
        </div>

        {/* Dropdown */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-text-main/40 tracking-wider">Таблица / Коллекция</label>
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-surface-base/5 border border-border-subtle text-xs text-text-main outline-none focus:ring-1 focus:ring-brand-soft/30"
          >
            {tables.map(t => (
              <option key={t.name} value={t.name} className="bg-surface-card text-text-main text-xs">
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-text-main/40 tracking-wider">Поиск по тексту</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Фильтр по содержимому..."
            className="w-full px-3 py-2 text-xs rounded-xl bg-surface-base/5 border border-border-subtle text-text-main outline-none placeholder:text-text-main/30"
          />
        </div>

        {/* Record lists */}
        <div className="rounded-xl border border-border-subtle bg-surface-card/10 overflow-hidden max-h-[380px] overflow-y-auto divide-y divide-border-subtle/30">
          {loading ? (
            <div className="p-8 text-center text-xs text-text-main/40">
              <Loader2 size={16} className="animate-spin mx-auto mb-2 text-brand-soft" />
              Загрузка данных...
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="p-8 text-center text-xs text-text-main/30">Записи отсутствуют</div>
          ) : (
            filteredRecords.map((r, idx) => {
              const id = getRecordId(r);
              const isSelected = selectedRecord === r;
              return (
                <button
                  key={`${id}-${idx}`}
                  onClick={() => setSelectedRecord(r)}
                  className={cn(
                    "w-full text-left px-4 py-2.5 text-xs transition-colors flex flex-col gap-0.5",
                    isSelected ? "bg-brand-soft/10 text-brand-soft" : "hover:bg-text-main/[0.01] text-text-main/70"
                  )}
                >
                  <span className="font-semibold truncate">{getRecordTitle(r)}</span>
                  <span className="text-[9px] font-mono text-text-main/30 truncate">{id}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column (Details) */}
      <div className="flex-1 space-y-4">
        {selectedRecord ? (
          <div className="p-5 rounded-2xl border border-border-subtle bg-surface-base/5 space-y-4">
            
            {/* Header info */}
            <div className="flex items-start justify-between gap-4 border-b border-border-subtle/50 pb-4">
              <div className="min-w-0">
                <span className="text-[9px] uppercase font-bold text-text-main/40 tracking-wider">Детали записи ({selectedTable})</span>
                <h4 className="text-sm font-bold text-text-main truncate mt-1">{getRecordTitle(selectedRecord)}</h4>
                <p className="text-[10px] font-mono text-text-main/30 mt-0.5 break-all">ID: {getRecordId(selectedRecord)}</p>
              </div>
              <button
                onClick={() => handleDeleteRecord(selectedRecord)}
                className="p-2 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                title="Удалить документ"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {/* Preformatted JSON block */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-text-main/40 tracking-wider">Значения всех полей (Raw JSON)</span>
              <pre className="p-4 rounded-xl bg-surface-base/80 border border-border-subtle overflow-auto max-h-[450px] text-[10px] font-mono text-text-main/80 select-all leading-normal whitespace-pre-wrap break-all">
                {JSON.stringify(selectedRecord, null, 2)}
              </pre>
            </div>

          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center border border-dashed border-border-subtle/50 rounded-2xl p-12 text-center text-xs text-text-main/30">
            <Database size={24} className="text-text-main/15 mb-2" />
            Выберите запись в левой панели для просмотра всех полей документа (как в консоли управления)
          </div>
        )}
      </div>

    </div>
  );
}
