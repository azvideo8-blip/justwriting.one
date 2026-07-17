import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Download, X, RotateCcw, Bug,
  RefreshCw, Loader2, Upload, ChevronDown, ChevronRight, Sparkles
} from 'lucide-react';
import { useDailyLimit } from '../hooks/useDailyLimit';
import { cn } from '../../../core/utils/utils';
import { APP_VERSION } from '../../../version';
import { SyncDiagnostics } from '../../settings/components/SyncDiagnostics';
import { AdminUsersTable } from '../../admin/components/AdminUsersTable';
import { LoadingSpinner } from '../../../shared/components/LoadingSpinner';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useDiagnosticsData, type Tab } from '../hooks/useDiagnosticsData';
import { DatabaseExplorer } from '../components/DatabaseExplorer';
import { EmbeddingDiagnostics } from '../components/EmbeddingDiagnostics';
import { ProfileFacets } from '../components/ProfileFacets';
import { QueueExplorer } from '../components/QueueExplorer';
import { FacetDiagnostics } from '../components/FacetDiagnostics';
import { ContactDoors } from '../components/ContactDoors';
import { AuthorPortrait } from '../components/AuthorPortrait';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { useToast } from '../../../shared/components/Toast';
import { AIService } from '../services/AIService';
import { AISummaryService } from '../services/AISummaryService';
import { getLocalDb, type AIDocumentSummary } from '../../../core/storage/localDb';
import { reportError } from '../../../shared/errors/reportError';
import { SyncService } from '../../../core/services/SyncService';
import { isFirestoreConnected } from '../../../core/firebase/firestore';

export function DiagnosticsPage() {
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuthStatus();
  const dailyLimit = useDailyLimit();

  const [activeTab, setActiveTab] = useState<Tab>('sync');

  const {
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
    handleResetCounter,
    handleResetUserLimit,
    handleClearMemory,
    handleCollapseVersions,
  } = useDiagnosticsData(profile, authLoading, activeTab);

  const handleDownloadDiagnostics = async () => {
    try {
      const pendingCount = await SyncService.getPendingCount();
      const firestoreConnected = isFirestoreConnected;
      
      const report = {
        userAgent: navigator.userAgent,
        locale: navigator.language || 'unknown',
        appVersion: APP_VERSION,
        syncQueueLength: pendingCount,
        isFirestoreConnected: firestoreConnected,
        localStats: stats,
        timestamp: Date.now()
      };

      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'justwriting-diagnostics.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      reportError(e, { action: 'download_diagnostics' });
    }
  };

  if (authLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size={10} />
    </div>
  );
}

function ReconcileSessionsButton() {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const { user } = useAuthStatus();
  const guestId = user?.uid ?? 'guest';

  const handleReconcile = async () => {
    setRunning(true);
    try {
      const { LocalDocumentService } = await import('../../../core/services/LocalDocumentService');
      const result = await LocalDocumentService.reconcileSessionsCount(guestId);
      const msg = `Документов исправлено: ${result.docsFixed}, профиль${result.profileFixed ? '' : ' не'} требовал исправления`;
      showToast(msg, 'success');
    } catch (e) {
      showToast('Ошибка реконсиляции: ' + String(e), 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => void handleReconcile()}
        disabled={running}
        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-surface-elevated border border-border-subtle text-text-main/80 text-xs font-semibold hover:text-text-main transition-colors"
      >
        <RotateCcw size={13} />
        {running ? 'Реконсиляция…' : 'Реконсиляция счётчика сессий'}
      </Button>
      <p className="mt-1.5 text-[11px] text-text-main/50">Пересчитывает sessionsCount у всех заметок по фактическим версиям. Исправляет расхождения.</p>
    </>
  );
}

function RebuildTimelineButton() {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);

  const handleRebuild = async () => {
    setRunning(true);
    try {
      const { AITimelineService } = await import('../services/AITimelineService');
      const count = await AITimelineService.rebuildFromSummaries();
      showToast(`Хронология ИИ успешно перестроена. Записей: ${count}`, 'success');
    } catch (e) {
      showToast('Ошибка пересбора хронологии: ' + String(e), 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => void handleRebuild()}
        disabled={running}
        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-surface-elevated border border-border-subtle text-text-main/80 text-xs font-semibold hover:text-text-main transition-colors"
      >
        <RotateCcw size={13} />
        {running ? 'Пересбор…' : 'Пересобрать хронологию ИИ'}
      </Button>
      <p className="mt-1.5 text-[11px] text-text-main/50">Пересобирает локальную хронологию из всех существующих анализов заметок с привязкой по датам.</p>
    </>
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
          <Bug className="text-accent-danger" />
          Диагностика и администрирование
        </h2>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => void handleDownloadDiagnostics()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-soft/10 border border-brand-soft/25 text-brand-soft text-xs font-semibold hover:bg-brand-soft/20 transition-[color,background-color] duration-200"
          >
            <Download size={13} />
            Скачать диагностику
          </Button>
          <IconButton 
            onClick={() => void navigate('/')} 
            className="p-2 rounded-lg text-text-main/60 hover:text-text-main hover:bg-surface-base/10 transition-colors"
            label="Close"
            icon={<X size={18} />}
          />
        </div>
      </div>

      {/* Tabs list */}
      <div className="flex flex-wrap gap-1 p-1 bg-surface-card/40 border border-border-subtle rounded-2xl w-fit">
        <Button
          onClick={() => setActiveTab('sync')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-[color,background-color,box-shadow] duration-200",
            activeTab === 'sync' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/60 hover:text-text-main"
          )}
        >
          Синхронизация
        </Button>
        <Button
          onClick={() => setActiveTab('db')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-[color,background-color,box-shadow] duration-200",
            activeTab === 'db' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/60 hover:text-text-main"
          )}
        >
          База данных
        </Button>
        <Button
          onClick={() => setActiveTab('users')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-[color,background-color,box-shadow] duration-200",
            activeTab === 'users' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/60 hover:text-text-main"
          )}
        >
          Пользователи
        </Button>
        <Button
          onClick={() => setActiveTab('ai_usage')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-[color,background-color,box-shadow] duration-200",
            activeTab === 'ai_usage' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/60 hover:text-text-main"
          )}
        >
          Статистика AI
        </Button>
        <Button
          onClick={() => setActiveTab('ai_profile')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-[color,background-color,box-shadow] duration-200",
            activeTab === 'ai_profile' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/60 hover:text-text-main"
          )}
        >
          Профиль AI
        </Button>
        <Button
          onClick={() => setActiveTab('stats')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-[color,background-color,box-shadow] duration-200",
            activeTab === 'stats' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/60 hover:text-text-main"
          )}
        >
          Система
        </Button>
        <Button
          onClick={() => setActiveTab('queue')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-[color,background-color,box-shadow] duration-200",
            activeTab === 'queue' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/60 hover:text-text-main"
          )}
        >
          Очередь
        </Button>
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
                  <p className="text-xs text-text-main/60 mt-1">Отправляет все локальные несинхронизированные заметки в Cloud Firestore.</p>
                </div>
                <Button
                  onClick={() => void handleSyncAllToCloud()}
                  disabled={bulkSyncing}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-text-main text-surface-base text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-colors min-h-[38px]"
                >
                  {bulkSyncing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  Загрузить всё в облако
                </Button>
              </div>

              <div className="p-5 rounded-2xl border border-border-subtle bg-surface-base/5 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-text-main">Импорт из облака</h3>
                  <p className="text-xs text-text-main/60 mt-1">Скачивает все резервные копии заметок из облака в локальный кэш IndexedDB.</p>
                </div>
                <Button
                  onClick={() => void handleImportAllFromCloud()}
                  disabled={bulkImporting}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-text-main text-surface-base text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-colors min-h-[38px]"
                >
                  {bulkImporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  Скачать всё из облака
                </Button>
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
          <div>
            <EmbeddingDiagnostics />
            <DatabaseExplorer userId={profile.uid} />
          </div>
        )}

        {/* Tab 3: Users */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-text-main mb-3">Зарегистрированные пользователи</h3>
            {loadingData ? (
              <div className="flex justify-center py-10"><LoadingSpinner size={8} /></div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-border-subtle">
                <AdminUsersTable users={users} onResetLimit={(uid, name) => void handleResetUserLimit(uid, name)} resettingUid={resettingUid} />
              </div>
            )}
          </div>
        )}

        {/* Tab 5: AI Stats */}
        {activeTab === 'ai_usage' && (() => {
          // Pricing per token (USD) — active chat model is hardcoded to DeepSeek
          // v4 Flash via OpenRouter (see functions/src/shared/aiProvider.ts).
          const activePricing = { in: 0.09 / 1_000_000, out: 0.18 / 1_000_000 };

          function calcCost(tokensIn: number, tokensOut: number) {
            return tokensIn * activePricing.in + tokensOut * activePricing.out;
          }
          function modelLabel(model: string) {
            if (model.includes('deepseek')) return 'DeepSeek';
            if (model.includes('gpt-oss')) return 'GPT OSS';
            if (model.includes('qwen')) return 'Qwen';
            if (model.includes('gemini')) return 'Gemini';
            return model.split('/').pop()?.slice(0, 20) ?? model.slice(0, 20);
          }
          function fnLabel(fn: string) {
            const map: Record<string, string> = { chat: 'Чат', 'chat-stream': 'Чат', summarize: 'Саммари', edit: 'Редактура', validate: 'Валидация' };
            return map[fn] ?? fn;
          }

          const q = aiSearchQuery.toLowerCase();
          const filtered = q
            ? aiUsage.filter(row => {
                const uProfile = users.find(u => u.uid === row.uid);
                const email = uProfile?.email?.toLowerCase() ?? '';
                const nick = uProfile?.nickname?.toLowerCase() ?? '';
                return row.uid.toLowerCase().includes(q) || email.includes(q) || nick.includes(q);
              })
            : aiUsage;
          const totalCost = filtered.reduce((s, r) => s + calcCost(r.promptTokens, r.completionTokens), 0);

          return (
            <div className="space-y-4">
              {/* Header: date + refresh */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-text-main">Статистика AI</h3>
                  <p className="text-[11px] text-text-main/50">Активная модель: DeepSeek v4 Flash (OpenRouter) · $0.09 / $0.18 за 1M токенов</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="date"
                    value={aiUsageDate}
                    onChange={e => setAiUsageDate(e.target.value)}
                    className="px-3 py-1.5 rounded-xl bg-surface-base/5 border border-border-subtle text-xs text-text-main outline-none"
                  />
                  <Button
                    onClick={() => void fetchAIUsage()}
                    disabled={aiUsageLoading}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-text-main text-surface-base text-xs font-semibold disabled:opacity-50 transition-colors"
                  >
                    {aiUsageLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    Обновить
                  </Button>
                </div>
              </div>

              {/* Usage limits bar */}
              {aiLimits && (() => {
                const totals = aiTotals ?? {
                  requests: filtered.reduce((s, r) => s + r.requests, 0),
                  promptTokens: filtered.reduce((s, r) => s + r.promptTokens, 0),
                  completionTokens: filtered.reduce((s, r) => s + r.completionTokens, 0),
                };
                const totalTokens = totals.promptTokens + totals.completionTokens;
                const isToday = aiUsageDate === new Date().toISOString().slice(0, 10);
                const metrics = [
                  { label: 'Запросов за день (суточный лимит)', used: totals.requests, cap: aiLimits.requestsPerDay },
                  { label: 'Токенов за день (бюджет затрат)', used: totalTokens, cap: aiLimits.tokensPerDay },
                ];
                return (
                  <div className="p-4 rounded-2xl border border-border-subtle bg-surface-base/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-bold text-text-main/60 uppercase tracking-wider">Лимиты {isToday ? '— сегодня' : `— ${aiUsageDate}`}</h4>
                      <span className="text-[10px] text-text-main/60">лимит на пользователя: {aiLimits.perUserDaily}/день</span>
                    </div>
                    {metrics.map(m => {
                      const pct = m.cap > 0 ? Math.min(100, (m.used / m.cap) * 100) : 0;
                      const over = m.used >= m.cap;
                      const warn = pct >= 80;
                      const color = over ? 'var(--accent-danger)' : warn ? 'var(--accent-warning)' : 'var(--accent-info)';
                      return (
                        <div key={m.label} className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-text-main/60">{m.label}</span>
                            <span className="font-mono text-text-main/70">
                              {m.used.toLocaleString()} / {m.cap.toLocaleString()}{' '}
                              <span className={cn(over ? 'text-accent-danger' : warn ? 'text-amber-400' : 'text-text-main/60')}>
                                ({pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%{over ? ' !' : ''})
                              </span>
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-border-subtle overflow-hidden">
                            <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Search + manual reset */}
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={aiSearchQuery}
                  onChange={e => setAiSearchQuery(e.target.value)}
                  placeholder="Поиск по email / никнейму / uid..."
                  className="flex-1 min-w-[200px] px-3 py-2 text-xs rounded-xl bg-surface-base/5 border border-border-subtle text-text-main placeholder:text-text-main/40 outline-none"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={manualResetUid}
                    onChange={e => setManualResetUid(e.target.value)}
                    placeholder="UID для сброса лимита..."
                    className="px-3 py-2 text-xs rounded-xl bg-surface-base/5 border border-border-subtle text-text-main placeholder:text-text-main/40 outline-none w-52"
                  />
                  <Button
                    onClick={() => {
                      if (!manualResetUid.trim()) return;
                      void handleResetUserLimit(manualResetUid.trim(), manualResetUid.trim());
                      setManualResetUid('');
                    }}
                    disabled={resettingUid !== null || !manualResetUid.trim()}
                    className="px-3 py-2 rounded-xl bg-accent-danger/10 border border-accent-danger/20 text-accent-danger hover:bg-accent-danger/20 disabled:opacity-50 transition-colors text-xs font-bold whitespace-nowrap"
                  >
                    {resettingUid === manualResetUid.trim() ? 'Сброс...' : 'Сбросить'}
                  </Button>
                </div>
              </div>

              {/* Users table */}
              <div className="rounded-2xl border border-border-subtle bg-surface-card/10 overflow-hidden">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b bg-surface-base/5 border-border-subtle text-text-main/60 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4 w-6"></th>
                      <th className="py-3 px-4">Пользователь</th>
                      <th className="py-3 px-4 text-right">Запросы</th>
                      <th className="py-3 px-4 text-right">Токены ↓</th>
                      <th className="py-3 px-4 text-right">Токены ↑</th>
                      <th className="py-3 px-4 text-right">Стоимость</th>
                      <th className="py-3 px-4 text-center">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(row => {
                      const uProfile = users.find(u => u.uid === row.uid);
                      const displayName = uProfile
                        ? `${uProfile.nickname ?? ''} (${uProfile.email ?? ''})`
                        : row.uid.slice(0, 8) + '…';
                      const cost = calcCost(row.promptTokens, row.completionTokens);
                      const isExpanded = expandedUid === row.uid;
                      return (
                        <React.Fragment key={row.uid}>
                          {/* User row */}
                          <tr
                            className="border-b border-border-subtle/40 hover:bg-text-main/[0.02] cursor-pointer"
                            onClick={() => void fetchUserEvents(row.uid)}
                          >
                            <td className="py-2.5 px-4 text-text-main/60">
                              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </td>
                            <td className="py-2.5 px-4 text-text-main/80 font-medium" title={row.uid}>{displayName}</td>
                            <td className="py-2.5 px-4 text-right text-text-main/60">{row.requests}</td>
                            <td className="py-2.5 px-4 text-right text-text-main/60">{row.promptTokens.toLocaleString()}</td>
                            <td className="py-2.5 px-4 text-right text-text-main/60">{row.completionTokens.toLocaleString()}</td>
                            <td className="py-2.5 px-4 text-right font-mono text-text-main/80">${cost.toFixed(4)}</td>
                            <td className="py-2.5 px-4 text-center" onClick={e => e.stopPropagation()}>
                              <Button
                                onClick={() => void handleResetUserLimit(row.uid, displayName)}
                                disabled={resettingUid !== null}
                                className="px-2 py-1 rounded-lg bg-accent-danger/10 border border-accent-danger/20 text-accent-danger hover:bg-accent-danger/20 disabled:opacity-50 transition-colors text-[10px] font-bold"
                              >
                                {resettingUid === row.uid ? '…' : 'Сброс'}
                              </Button>
                            </td>
                          </tr>
                          {/* Expanded events */}
                          {isExpanded && (
                            <tr className="border-b border-border-subtle/40 bg-surface-base/5">
                              <td colSpan={7} className="px-4 py-3">
                                {userEventsLoading ? (
                                  <div className="flex items-center gap-2 text-text-main/60 text-xs py-1">
                                    <Loader2 size={12} className="animate-spin" /> Загрузка событий…
                                  </div>
                                ) : userEvents.length === 0 ? (
                                  <p className="text-text-main/60 text-xs py-1 italic">Нет событий за выбранную дату (данные записываются с текущей версии)</p>
                                ) : (
                                  <table className="w-full text-[11px] border-collapse">
                                    <thead>
                                      <tr className="text-text-main/60 text-[10px] uppercase tracking-wider">
                                        <th className="text-left pb-1.5 pr-4 font-bold">Время</th>
                                        <th className="text-left pb-1.5 pr-4 font-bold">Функция</th>
                                        <th className="text-left pb-1.5 pr-4 font-bold">Модель</th>
                                        <th className="text-right pb-1.5 pr-4 font-bold">Токены ↓</th>
                                        <th className="text-right pb-1.5 pr-4 font-bold">Токены ↑</th>
                                        <th className="text-right pb-1.5 font-bold">Стоимость</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {userEvents.map(ev => {
                                        const evCost = ev.tokensIn * activePricing.in + ev.tokensOut * activePricing.out;
                                        return (
                                          <tr key={ev.id} className="border-t border-border-subtle/20">
                                            <td className="py-1.5 pr-4 font-mono text-text-main/60">
                                              {ev.ts ? new Date(ev.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                                            </td>
                                            <td className="py-1.5 pr-4 text-text-main/60">{fnLabel(ev.fn)}</td>
                                            <td className="py-1.5 pr-4 text-text-main/60">{modelLabel(ev.model)}</td>
                                            <td className="py-1.5 pr-4 text-right font-mono text-text-main/60">{ev.tokensIn.toLocaleString()}</td>
                                            <td className="py-1.5 pr-4 text-right font-mono text-text-main/60">{ev.tokensOut.toLocaleString()}</td>
                                            <td className="py-1.5 text-right font-mono text-text-main/70">${evCost.toFixed(5)}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  {filtered.length > 0 && (
                    <tfoot>
                      <tr className="border-t bg-surface-base/5 border-border-subtle font-bold text-text-main text-xs">
                        <td className="py-3 px-4"></td>
                        <td className="py-3 px-4">Итого</td>
                        <td className="py-3 px-4 text-right">{filtered.reduce((s, r) => s + r.requests, 0)}</td>
                        <td className="py-3 px-4 text-right">{filtered.reduce((s, r) => s + r.promptTokens, 0).toLocaleString()}</td>
                        <td className="py-3 px-4 text-right">{filtered.reduce((s, r) => s + r.completionTokens, 0).toLocaleString()}</td>
                        <td className="py-3 px-4 text-right font-mono">${totalCost.toFixed(4)}</td>
                        <td className="py-3 px-4"></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {aiUsage.length === 0 && !aiUsageLoading && (
                <div className="py-12 text-center text-xs text-text-main/60">Нет данных об AI-активности за выбранную дату</div>
              )}
            </div>
          );
        })()}

        {/* Tab 6: AI Profile */}
        {activeTab === 'ai_profile' && (
          <div className="space-y-6">
            <h3 className="text-sm font-semibold text-text-main mb-3">Профиль автора & AI логи</h3>

            <ProfileFacets />
            {import.meta.env.DEV && <FacetDiagnostics />}

            <ContactDoors />

            {/* UXFIX-3: Mass AI analysis */}
            <MassAnalyzeNotes />

            <AuthorPortrait />

            {summaryLogs.length > 0 && (
              <div className="rounded-2xl border border-border-subtle overflow-hidden">
                <div className="px-5 py-3 border-b border-border-subtle bg-surface-base/5">
                  <span className="text-xs font-bold text-text-main/60 uppercase tracking-wider">История обработки заметок ИИ</span>
                </div>
                <div className="divide-y divide-border-subtle/50 text-xs">
                  {summaryLogs.map(log => (
                    <div key={log.id} className="px-5 py-3 flex items-center gap-3 hover:bg-text-main/[0.01]">
                      <span className="text-[10px] font-mono text-text-main/60">{new Date(log.processedAt).toLocaleString('ru-RU')}</span>
                      <span className="text-xs text-text-main/70 truncate flex-1 font-medium">«{log.title}»</span>
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-brand-soft/10 text-brand-soft">{log.tone}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2">
              <Button
                onClick={() => void handleResetCounter()}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent-danger/10 border border-accent-danger/20 text-accent-danger text-xs font-semibold hover:bg-accent-danger/20 transition-colors"
              >
                <RotateCcw size={13} />
                Сбросить суточный счетчик ИИ
              </Button>
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
                  { label: 'Локальная база (IndexedDB) версия', value: '8' },
                  { label: 'Локальных документов на устройстве', value: stats.localDocs },
                  { label: 'Документов в облаке (Firestore)', value: stats.cloudDocs },
                  { label: 'Только на этом устройстве (local only)', value: stats.localDocs - stats.cloudDocs },
                  { label: 'Саммари ИИ сохранено', value: stats.summaries },
                  { label: 'Эмбеддингов сохранено', value: stats.embeddings },
                  { label: 'Диалогов ИИ записано', value: stats.dialogues },
                  { label: 'Кастомных персон создано', value: stats.customPersonas },
                  { label: 'Памяти диалогов (DLG-1)', value: stats.memories },
                  { label: 'Лимит ИИ за сутки', value: `${dailyLimit.used} / ${dailyLimit.limit} запросов` }
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between p-4 rounded-xl border border-border-subtle bg-surface-base/5">
                    <span className="text-xs text-text-main/60 font-medium">{r.label}</span>
                    <span className="text-xs font-mono font-bold text-text-main">{r.value}</span>
                  </div>
                ))}
              </div>
            )}
            {statsLoaded && (
              <div className="pt-2">
                <Button
                  onClick={() => void handleClearMemory()}
                  disabled={stats.memories === 0}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent-danger/10 border border-accent-danger/20 text-accent-danger text-xs font-semibold hover:bg-accent-danger/20 transition-colors disabled:opacity-40"
                >
                  <RotateCcw size={13} />
                  Очистить память ИИ ({stats.memories})
                </Button>
                <p className="mt-1.5 text-[11px] text-text-main/50">Удаляет накопленные факты/инсайты из прошлых бесед. Диалоги и заметки не затрагиваются.</p>
                <div className="mt-3">
                  <Button
                    onClick={() => void handleCollapseVersions()}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-surface-elevated border border-border-subtle text-text-main/80 text-xs font-semibold hover:text-text-main transition-colors"
                  >
                    <RotateCcw size={13} />
                    Схлопнуть версии заметок
                  </Button>
                  <p className="mt-1.5 text-[11px] text-text-main/50">Оставляет у каждой заметки только последнюю версию (убирает «2 / N»). Текст не меняется.</p>
                </div>
                <div className="mt-3">
                  <ReconcileSessionsButton />
                </div>
                <div className="mt-3">
                  <RebuildTimelineButton />
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'queue' && <QueueExplorer userId={profile.uid} />}

      </div>


    </div>
  );
}

import { AIBackgroundBudget } from '../services/AIBackgroundBudget';

// UXFIX-3: Mass AI analysis of all unanalyzed notes
function MassAnalyzeNotes() {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [stats, setStats] = useState({
    total: 0,
    summarized: 0,
    remaining: 0,
    daysToComplete: 0,
    budgetSpent: 0,
    budgetLimit: 25,
  });

  const loadStats = React.useCallback(async () => {
    try {
      const db = await getLocalDb();
      const docs = await db.getAll('documents');
      const summaries = await db.getAll('aiSummaries');
      const total = docs.length;
      const summarized = summaries.length;
      const remaining = Math.max(0, total - summarized);
      const budget = AIBackgroundBudget.budgetStatus();
      setStats({
        total,
        summarized,
        remaining,
        daysToComplete: Math.ceil(remaining / budget.budget),
        budgetSpent: budget.spent,
        budgetLimit: budget.budget,
      });
    } catch (e) {
      console.error(e);
    }
  }, []);

  React.useEffect(() => {
    void loadStats();
    const handleRefresh = () => { void loadStats(); };
    window.addEventListener('archive-refresh', handleRefresh);
    return () => window.removeEventListener('archive-refresh', handleRefresh);
  }, [loadStats]);

  const handleMassAnalyze = async () => {
    if (!navigator.onLine) {
      showToast('Данная функция работает только при подключении к сети', 'error');
      return;
    }
    setRunning(true);
    setProgress({ done: 0, total: 10, failed: 0 });
    try {
      const db = await getLocalDb();
      const docs = await db.getAll('documents');
      const summaries = await db.getAll('aiSummaries');
      const analyzed = new Set(summaries.map(s => s.documentId));
      const pending = docs.filter(d => !analyzed.has(d.id));

      if (pending.length === 0) {
        showToast('Все заметки уже проанализированы', 'success');
        setRunning(false);
        return;
      }

      const runLimit = Math.min(10, pending.length);
      setProgress({ done: 0, total: runLimit, failed: 0 });

      for (let i = 0; i < runLimit; i++) {
        if (!AIBackgroundBudget.canSpend(1)) {
          showToast('Достигнут дневной лимит бюджета ИИ (25/25)', 'error');
          break;
        }

        const doc = pending[i]!;
        try {
          const versions = await db.getAllFromIndex('versions', 'by-document', doc.id);
          if (versions.length === 0) continue;
          versions.sort((a, b) => b.version - a.version);
          const content = versions[0]?.content ?? '';
          if (content.length < 50) continue;

          // Build recentContext
          const currentSummaries = await db.getAll('aiSummaries');
          currentSummaries.sort((a, b) => b.processedAt - a.processedAt);
          const recentContext = currentSummaries.slice(0, 3).map(s => s.summary || s.tone).filter(Boolean).join('\n');

          const result = await AIService.summarize({
            content: content.slice(0, 50_000),
            mood: doc.mood,
            recentContext
          });

            if (result.ok) {
            const { sha256Hex } = await import('../utils/embeddingIndexer');
            const hash = await sha256Hex(content);
            const s: AIDocumentSummary = {
              documentId: doc.id,
              tone: result.summary.tone,
              frequentWords: result.summary.frequentWords,
              insights: result.summary.insights,
              themes: result.summary.themes,
              extractedFacts: result.summary.extractedFacts,
              processedAt: Date.now(),
              contentHash: hash,
            };
            if (result.summary.summary !== undefined) s.summary = result.summary.summary;
            if (result.summary.mentionedPeople !== undefined) s.mentionedPeople = result.summary.mentionedPeople;
            if (result.summary.commitments !== undefined) s.commitments = result.summary.commitments;
            if (result.summary.valence !== undefined) s.valence = result.summary.valence;
            if (result.summary.arousal !== undefined) s.arousal = result.summary.arousal;
            if (result.summary.echo !== undefined) s.echo = result.summary.echo;
            await AISummaryService.save(s);
            AIBackgroundBudget.spend(1);
            window.dispatchEvent(new Event('archive-refresh'));
          } else {
            setProgress(p => ({ ...p, failed: p.failed + 1 }));
            if (result.error === 'DAILY_LIMIT' || result.error === 'RATE_LIMIT') {
              showToast('Превышен лимит запросов к ИИ', 'error');
              break;
            }
          }
        } catch {
          setProgress(p => ({ ...p, failed: p.failed + 1 }));
        }
        setProgress(p => ({ ...p, done: p.done + 1 }));
        // Small delay between calls
        await new Promise(r => setTimeout(r, 500));
      }

      showToast(`Пакетный анализ завершён`, 'success');
    } catch (e) {
      reportError(e, { action: 'diagnostics_mass_analyze' });
      showToast('Ошибка массового анализа', 'error');
    } finally {
      setRunning(false);
      void loadStats();
    }
  };

  return (
    <div className="rounded-2xl bg-surface-base/5 border border-border-subtle overflow-hidden space-y-4 p-5">
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle/50 pb-3">
        <div>
          <span className="text-xs font-bold text-text-main/60 uppercase tracking-wider block">Фоновый анализ ИИ заметок</span>
          <span className="text-[10px] text-text-main/40 block mt-1">Ограничение бюджета ИИ предупреждает резкий расход токенов.</span>
        </div>
        <Button
          onClick={() => void handleMassAnalyze()}
          disabled={running || stats.remaining === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-soft/20 bg-brand-soft/10 text-brand-soft text-[10px] font-bold disabled:opacity-50"
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {running ? `Анализ… ${progress.done}/${progress.total}` : 'Проанализировать 10 сейчас'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 text-xs">
        <div className="space-y-1">
          <div className="text-text-main/40 text-[10px] uppercase">Покрытие саммари</div>
          <div className="font-semibold text-text-main">
            {stats.summarized} / {stats.total} заметок ({stats.total > 0 ? Math.round((stats.summarized / stats.total) * 100) : 0}%)
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-text-main/40 text-[10px] uppercase">Оценка завершения фоном</div>
          <div className="font-semibold text-text-main">
            {stats.remaining > 0 ? `~${stats.daysToComplete} дн. (при бюджете ${stats.budgetLimit}/день)` : 'Завершено 🎉'}
          </div>
        </div>
        <div className="space-y-1 col-span-2 border-t border-border-subtle/30 pt-3">
          <div className="text-text-main/40 text-[10px] uppercase">Использованный дневной бюджет ИИ (SEAM-0)</div>
          <div className="font-semibold text-text-main">
            {stats.budgetSpent} / {stats.budgetLimit} вызовов
          </div>
          <div className="h-1.5 rounded-full bg-surface-base/30 overflow-hidden mt-1">
            <div
              className="h-full bg-brand-soft transition-[width] duration-300"
              style={{ width: `${Math.min(100, (stats.budgetSpent / stats.budgetLimit) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {running && (
        <div className="pt-2 border-t border-border-subtle/30">
          <div className="h-1.5 rounded-full bg-surface-base/30 overflow-hidden">
            <div
              className="h-full bg-brand-soft transition-[width] duration-300"
              style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          {progress.failed > 0 && (
            <div className="text-[10px] text-accent-danger/60 mt-1">Ошибок: {progress.failed}</div>
          )}
        </div>
      )}
    </div>
  );
}
