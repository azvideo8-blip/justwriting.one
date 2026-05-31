import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { 
  Download, X, RotateCcw, Bug, 
  RefreshCw, Loader2, Upload 
} from 'lucide-react';
import { useDailyLimit } from '../hooks/useDailyLimit';
import { cn } from '../../../core/utils/utils';
import { APP_VERSION } from '../../../version';
import { SyncDiagnostics } from '../../settings/components/SyncDiagnostics';
import { AdminUsersTable } from '../../admin/components/AdminUsersTable';
import { LoadingSpinner } from '../../../shared/components/LoadingSpinner';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { useDiagnosticsData, type Tab } from '../hooks/useDiagnosticsData';
import { DatabaseExplorer } from '../components/DatabaseExplorer';

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
  } = useDiagnosticsData(profile, authLoading, activeTab);

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
              {/* Manual reset section */}
              <div className="p-5 rounded-2xl border border-border-subtle bg-surface-base/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-text-main">Сбросить лимит вручную по UID</h4>
                  <p className="text-[10px] text-text-main/40">Сбрасывает суточный лимит запросов, если пользователя нет в таблице.</p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto min-w-[280px]">
                  <input
                    type="text"
                    value={manualResetUid}
                    onChange={e => setManualResetUid(e.target.value)}
                    placeholder="Введите UID пользователя..."
                    className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-surface-base/5 border border-border-subtle text-text-main placeholder:text-text-main/30 outline-none"
                  />
                  <button
                    onClick={async () => {
                      if (!manualResetUid.trim()) return;
                      await handleResetUserLimit(manualResetUid.trim(), manualResetUid.trim());
                      setManualResetUid('');
                    }}
                    disabled={resettingUid !== null || !manualResetUid.trim()}
                    className="px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors text-xs font-bold whitespace-nowrap"
                  >
                    {resettingUid === manualResetUid.trim() ? 'Сброс...' : 'Сбросить'}
                  </button>
                </div>
              </div>

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

              {aiLimits && (() => {
                const totals = aiTotals ?? {
                  requests: filtered.reduce((s, r) => s + r.requests, 0),
                  promptTokens: filtered.reduce((s, r) => s + r.promptTokens, 0),
                  completionTokens: filtered.reduce((s, r) => s + r.completionTokens, 0),
                };
                const totalTokens = totals.promptTokens + totals.completionTokens;
                const isToday = aiUsageDate === new Date().toISOString().slice(0, 10);
                const metrics = [
                  { label: 'Запросов за день (RPD, лимит Tier 1)', used: totals.requests, cap: aiLimits.requestsPerDay },
                  { label: 'Токенов за день (бюджет затрат)', used: totalTokens, cap: aiLimits.tokensPerDay },
                ];
                return (
                  <div className="p-5 rounded-2xl border border-border-subtle bg-surface-base/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-text-main">Лимиты Gemini API · Tier 1 (gemini-2.5-flash) {isToday ? '— сегодня' : `— ${aiUsageDate}`}</h4>
                      <span className="text-[10px] text-text-main/35">контролируется в бэкэнде</span>
                    </div>
                    {metrics.map(m => {
                      const pct = m.cap > 0 ? Math.min(100, (m.used / m.cap) * 100) : 0;
                      const over = m.used >= m.cap;
                      const warn = pct >= 80;
                      const color = over ? '#f87171' : warn ? '#fbbf24' : '#7d4fd1';
                      return (
                        <div key={m.label} className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-text-main/60">{m.label}</span>
                            <span className="font-mono text-text-main/80">
                              {m.used.toLocaleString()} / {m.cap.toLocaleString()}{' '}
                              <span className={cn(over ? 'text-red-400' : warn ? 'text-amber-400' : 'text-text-main/40')}>
                                ({pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%{over ? ' — превышено' : ''})
                              </span>
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-border-subtle overflow-hidden">
                            <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-text-main/40 pt-1">
                      <span>Лимит на пользователя: <b className="text-text-main/60">{aiLimits.perUserDaily}/день</b></span>
                      <span>Лимиты в минуту (Tier 1): <b className="text-text-main/60">{aiLimits.requestsPerMinute.toLocaleString()} RPM</b>, <b className="text-text-main/60">{aiLimits.tokensPerMinute.toLocaleString()} TPM</b></span>
                    </div>
                  </div>
                );
              })()}

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
                      <th className="py-3 px-4 text-center">Действие</th>
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
                          <td className="py-2.5 px-4 text-center">
                            <button
                              onClick={() => handleResetUserLimit(row.uid, displayName)}
                              disabled={resettingUid !== null}
                              className="px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors text-[10px] font-bold"
                            >
                              {resettingUid === row.uid ? 'Сброс...' : 'Сбросить'}
                            </button>
                          </td>
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
                        <td className="py-3 px-4"></td>
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
            
            <div className="rounded-2xl bg-surface-base/5 border border-border-subtle overflow-hidden">
              <div className="px-5 py-3 border-b border-border-subtle flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-text-main/50 uppercase tracking-wider">Психологический портрет пользователя</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={handleGeneratePortrait}
                    disabled={portraitGenerating}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-brand-soft/20 bg-brand-soft/10 text-brand-soft text-[10px] font-bold disabled:opacity-50"
                  >
                    {portraitGenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {portraitGenerating ? 'Генерация…' : (portraitText ? 'Обновить' : 'Сгенерировать')}
                  </button>
                  <button
                    onClick={handleExportProfile}
                    disabled={!portraitText}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-border-subtle text-text-main/60 text-[10px] font-bold disabled:opacity-40"
                  >
                    <Download size={12} />
                    Экспорт .md
                  </button>
                </div>
              </div>
              <div className="px-5 py-4 max-h-60 overflow-y-auto text-xs text-text-main/60 whitespace-pre-wrap leading-relaxed">
                {portraitText || <span className="italic text-text-main/25">Портрет ещё не создан — нажмите «Сгенерировать» (нужно ≥3 проанализированных заметок)</span>}
              </div>
            </div>

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
