import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Download, X, RotateCcw, Bug,
  RefreshCw, Loader2, Upload, ChevronDown, ChevronRight
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
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';

export function DiagnosticsPage() {
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuthStatus();
  const dailyLimit = useDailyLimit();

  const [activeTab, setActiveTab] = useState<Tab>('sync');

  const [aiPricingModel, setAiPricingModel] = useState<'deepseek' | 'gemini'>('deepseek');

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
          <Bug className="text-accent-danger" />
          Диагностика и администрирование
        </h2>
        <IconButton 
          onClick={() => void navigate('/')} 
          className="p-2 rounded-lg text-text-main/40 hover:text-text-main hover:bg-surface-base/10 transition-colors"
          label="Close"
          icon={<X size={18} />}
        />
      </div>

      {/* Tabs list */}
      <div className="flex flex-wrap gap-1 p-1 bg-surface-card/40 border border-border-subtle rounded-2xl w-fit">
        <Button
          onClick={() => setActiveTab('sync')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200",
            activeTab === 'sync' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
          )}
        >
          Синхронизация
        </Button>
        <Button
          onClick={() => setActiveTab('db')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200",
            activeTab === 'db' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
          )}
        >
          База данных
        </Button>
        <Button
          onClick={() => setActiveTab('users')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200",
            activeTab === 'users' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
          )}
        >
          Пользователи
        </Button>
        <Button
          onClick={() => setActiveTab('ai_usage')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200",
            activeTab === 'ai_usage' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
          )}
        >
          Статистика AI
        </Button>
        <Button
          onClick={() => setActiveTab('ai_profile')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200",
            activeTab === 'ai_profile' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
          )}
        >
          Профиль AI
        </Button>
        <Button
          onClick={() => setActiveTab('stats')}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200",
            activeTab === 'stats' ? "bg-surface-base/40 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
          )}
        >
          Система
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
                  <p className="text-xs text-text-main/40 mt-1">Отправляет все локальные несинхронизированные заметки в Cloud Firestore.</p>
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
                  <p className="text-xs text-text-main/40 mt-1">Скачивает все резервные копии заметок из облака в локальный кэш IndexedDB.</p>
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
          // Pricing per token (USD)
          const PRICING = {
            'deepseek-v4-flash': { label: 'DeepSeek v4 Flash', in: 0.14 / 1_000_000, out: 0.28 / 1_000_000 },
            deepseek:            { label: 'DeepSeek v4 Pro',    in: 1.74 / 1_000_000, out: 3.48 / 1_000_000 },
            gemini:              { label: 'Gemini 2.5 Flash',   in: 0.15 / 1_000_000, out: 0.60 / 1_000_000 },
          };

          // Resolve pricing key from active model string
          function pricingKeyFromModel(model: string): keyof typeof PRICING {
            if (model.includes('deepseek-v4-flash')) return 'deepseek-v4-flash';
            if (model.includes('deepseek')) return 'deepseek';
            return 'gemini';
          }
          // If currentAIModel is known, auto-select its pricing; user can still override via dropdown
          const resolvedPricingKey = currentAIModel ? pricingKeyFromModel(currentAIModel) : aiPricingModel;
          const pricing = PRICING[aiPricingModel] ?? PRICING[resolvedPricingKey];

          function calcCost(tokensIn: number, tokensOut: number) {
            return tokensIn * pricing.in + tokensOut * pricing.out;
          }
          function modelLabel(model: string) {
            if (model.includes('deepseek') || model.includes('fireworks')) return 'DeepSeek';
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
              {/* Header: date + model selector + refresh */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h3 className="text-sm font-semibold text-text-main">Статистика AI</h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={aiPricingModel}
                    onChange={e => setAiPricingModel(e.target.value as keyof typeof PRICING)}
                    className="px-3 py-1.5 rounded-xl bg-surface-base/5 border border-border-subtle text-xs text-text-main outline-none cursor-pointer"
                  >
                    <option value="deepseek-v4-flash">DeepSeek v4 Flash ⭐</option>
                    <option value="deepseek">DeepSeek v4 Pro</option>
                    <option value="gemini">Gemini 2.5 Flash</option>
                  </select>
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

              {/* Model switcher */}
              <div className="p-4 rounded-2xl border border-border-subtle bg-surface-base/5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[10px] font-bold text-text-main/40 uppercase tracking-wider">Активная модель</h4>
                  {currentAIModel && (
                    <span className="text-[10px] font-mono text-brand-soft bg-brand-soft/10 px-2 py-0.5 rounded-full">
                      {currentAIModel.split('/').pop()}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    { id: 'accounts/fireworks/models/deepseek-v4-flash', label: 'DeepSeek v4 Flash', badge: '⭐ дешевле в 12×', price: '$0.14/$0.28' },
                    { id: 'accounts/fireworks/models/deepseek-v4-pro',   label: 'DeepSeek v4 Pro',  badge: 'reasoning',    price: '$1.74/$3.48' },
                    { id: 'accounts/fireworks/models/gpt-oss-120b',      label: 'GPT OSS 120B',     badge: 'OpenAI',       price: '$0.15/$0.60' },
                  ] as const).map(m => {
                    const isActive = currentAIModel === m.id;
                    return (
                      <Button
                        key={m.id}
                        onClick={() => void switchAIModel(m.id)}
                        disabled={modelSwitching || isActive}
                        className={cn(
                          "flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl border text-left transition-all text-[10px] disabled:cursor-default",
                          isActive
                            ? "border-brand-soft/40 bg-brand-soft/10 text-text-main"
                            : "border-border-subtle bg-surface-base/5 text-text-main/60 hover:border-brand-soft/20 hover:text-text-main hover:bg-surface-base/10"
                        )}
                      >
                        <span className="font-bold text-xs">{m.label}</span>
                        <span className={cn("font-mono", isActive ? "text-brand-soft" : "text-text-main/40")}>{m.price} / 1M</span>
                        <span className={cn(isActive ? "text-text-main/50" : "text-text-main/30")}>{m.badge}{isActive ? ' · активна' : ''}</span>
                      </Button>
                    );
                  })}
                  {modelSwitching && <Loader2 size={14} className="animate-spin self-center text-text-main/30" />}
                </div>
                <p className="text-[10px] text-text-main/30 mt-2">Применяется ко всем AI-функциям (чат, саммари, редактура). Vercel /api/chat обновится в течение 60 сек.</p>
              </div>

              {/* Pricing table */}
              <div className="p-4 rounded-2xl border border-border-subtle bg-surface-base/5">
                <h4 className="text-[10px] font-bold text-text-main/40 uppercase tracking-wider mb-3">Тарифы (цены актуальны на дату поставки · docs.fireworks.ai, ai.google.dev)</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-text-main/40 text-[10px] uppercase tracking-wider">
                        <th className="text-left pb-2 pr-4 font-bold">Модель</th>
                        <th className="text-right pb-2 pr-4 font-bold">Вход / 1M</th>
                        <th className="text-right pb-2 pr-4 font-bold">Выход / 1M</th>
                        <th className="text-right pb-2 font-bold">Примерно / запрос</th>
                      </tr>
                    </thead>
                    <tbody>
                      {([
                        { key: 'deepseek-v4-flash', name: 'DeepSeek v4 Flash', provider: 'Fireworks', inP: 0.14, outP: 0.28 },
                        { key: 'gemini',            name: 'Gemini 2.5 Flash',  provider: 'Google',    inP: 0.15, outP: 0.60 },
                        { key: 'deepseek',          name: 'DeepSeek v4 Pro',   provider: 'Fireworks', inP: 1.74, outP: 3.48 },
                      ] as const).map(r => {
                        // Estimate: ~4k in tokens, ~800 out tokens per average request
                        const estCost = (4000 * r.inP + 800 * r.outP) / 1_000_000;
                        const isSelected = aiPricingModel === r.key;
                        return (
                          <tr key={r.key} className={cn("border-t border-border-subtle/40", isSelected && "bg-brand-soft/5")}>
                            <td className="py-2 pr-4 text-text-main/80 font-medium">
                              {r.name} <span className="text-text-main/30">({r.provider})</span>
                            </td>
                            <td className="py-2 pr-4 text-right font-mono text-text-main/70">${r.inP}</td>
                            <td className="py-2 pr-4 text-right font-mono text-text-main/70">${r.outP}</td>
                            <td className="py-2 text-right font-mono text-text-main/50">≈${estCost.toFixed(4)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-text-main/30 mt-2">Выбранная модель выше используется для расчёта стоимости в таблице пользователей. Для новых запросов модель определяется из события.</p>
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
                      <h4 className="text-[10px] font-bold text-text-main/40 uppercase tracking-wider">Лимиты {isToday ? '— сегодня' : `— ${aiUsageDate}`}</h4>
                      <span className="text-[10px] text-text-main/30">лимит на пользователя: {aiLimits.perUserDaily}/день</span>
                    </div>
                    {metrics.map(m => {
                      const pct = m.cap > 0 ? Math.min(100, (m.used / m.cap) * 100) : 0;
                      const over = m.used >= m.cap;
                      const warn = pct >= 80;
                      const color = over ? '#f87171' : warn ? '#fbbf24' : '#7d4fd1';
                      return (
                        <div key={m.label} className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-text-main/50">{m.label}</span>
                            <span className="font-mono text-text-main/70">
                              {m.used.toLocaleString()} / {m.cap.toLocaleString()}{' '}
                              <span className={cn(over ? 'text-accent-danger' : warn ? 'text-amber-400' : 'text-text-main/40')}>
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
                  className="flex-1 min-w-[200px] px-3 py-2 text-xs rounded-xl bg-surface-base/5 border border-border-subtle text-text-main placeholder:text-text-main/30 outline-none"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={manualResetUid}
                    onChange={e => setManualResetUid(e.target.value)}
                    placeholder="UID для сброса лимита..."
                    className="px-3 py-2 text-xs rounded-xl bg-surface-base/5 border border-border-subtle text-text-main placeholder:text-text-main/30 outline-none w-52"
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
                    <tr className="border-b bg-surface-base/5 border-border-subtle text-text-main/40 font-bold uppercase tracking-wider text-[10px]">
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
                            <td className="py-2.5 px-4 text-text-main/30">
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
                                  <div className="flex items-center gap-2 text-text-main/40 text-xs py-1">
                                    <Loader2 size={12} className="animate-spin" /> Загрузка событий…
                                  </div>
                                ) : userEvents.length === 0 ? (
                                  <p className="text-text-main/30 text-xs py-1 italic">Нет событий за выбранную дату (данные записываются с текущей версии)</p>
                                ) : (
                                  <table className="w-full text-[11px] border-collapse">
                                    <thead>
                                      <tr className="text-text-main/30 text-[10px] uppercase tracking-wider">
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
                                        const evCost = ev.tokensIn * pricing.in + ev.tokensOut * pricing.out;
                                        return (
                                          <tr key={ev.id} className="border-t border-border-subtle/20">
                                            <td className="py-1.5 pr-4 font-mono text-text-main/40">
                                              {ev.ts ? new Date(ev.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                                            </td>
                                            <td className="py-1.5 pr-4 text-text-main/60">{fnLabel(ev.fn)}</td>
                                            <td className="py-1.5 pr-4 text-text-main/50">{modelLabel(ev.model)}</td>
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
                  <Button
                    onClick={() => void handleGeneratePortrait()}
                    disabled={portraitGenerating}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-brand-soft/20 bg-brand-soft/10 text-brand-soft text-[10px] font-bold disabled:opacity-50"
                  >
                    {portraitGenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {portraitGenerating ? 'Генерация…' : (portraitText ? 'Обновить' : 'Сгенерировать')}
                  </Button>
                  <Button
                    onClick={() => void handleExportProfile()}
                    disabled={!portraitText}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-border-subtle text-text-main/60 text-[10px] font-bold disabled:opacity-40"
                  >
                    <Download size={12} />
                    Экспорт .md
                  </Button>
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
