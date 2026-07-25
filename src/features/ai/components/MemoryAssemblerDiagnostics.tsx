import { useState, useEffect } from 'react';
import { InjectionJournal, JournalEntry, JournalStats } from '../services/injectionJournal';
import { MemoryFlagsService, MemoryFeatureFlags } from '../services/memoryFlags';
import { Button } from '../../../shared/components/Button';
import { cn } from '../../../core/utils/utils';
import { Sparkles, CheckCircle, AlertTriangle, RefreshCw, Trash2, Layers } from 'lucide-react';

export function MemoryAssemblerDiagnostics() {
  const [stats, setStats] = useState<JournalStats>(() => InjectionJournal.getStats());
  const [entries, setEntries] = useState<JournalEntry[]>(() => InjectionJournal.getEntries(30));
  const [flags, setFlags] = useState<MemoryFeatureFlags>(() => MemoryFlagsService.getFlags());
  const [loading, setLoading] = useState(false);

  const refreshData = async () => {
    setLoading(true);
    try {
      await InjectionJournal.loadEntriesFromDb();
      setStats(InjectionJournal.getStats());
      setEntries(InjectionJournal.getEntries(30));
      setFlags(MemoryFlagsService.getFlags());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshData();
  }, []);

  const handleToggleFlag = (key: keyof MemoryFeatureFlags) => {
    MemoryFlagsService.setFlag(key, !flags[key]);
    setFlags(MemoryFlagsService.getFlags());
  };

  const handleResetFlags = () => {
    MemoryFlagsService.resetFlags();
    setFlags(MemoryFlagsService.getFlags());
  };

  const handleClearJournal = () => {
    InjectionJournal.clearJournal();
    void refreshData();
  };

  const isGoNoGoMet =
    stats.totalTurns >= 100 &&
    stats.medianOverlap !== null &&
    stats.medianOverlap >= 0.8 &&
    stats.mandatoryDropsCount === 0 &&
    stats.p90BudgetUsage <= stats.maxBudget;

  return (
    <div className="space-y-6">
      {/* Header & Go/No-Go Status */}
      <div className="p-4 bg-surface-card/60 border border-border-subtle rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent-main" />
            <h3 className="text-sm font-bold text-text-main">MIND W2 Memory Assembler Diagnostics</h3>
          </div>
          <p className="text-xs text-text-main/60 mt-1">
            Shadow-mode instrumentation, overlap metrics baseline, and per-block cutover flags.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => void refreshData()}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-surface-base/60 text-text-main border border-border-subtle flex items-center gap-1.5"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Обновить
          </Button>
          <Button
            onClick={handleClearJournal}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-status-error/10 text-status-error border border-status-error/20 flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Очистить лог
          </Button>
        </div>
      </div>

      {/* Executive Go/No-Go Bar Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-1">
          <span className="text-xs font-medium text-text-main/60">Всего сессий в логе</span>
          <div className="text-xl font-bold text-text-main">{stats.totalTurns} / 100</div>
          <div className="text-[10px] text-text-main/50">Порог готовности ≥ 100 сессий</div>
        </div>

        <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-1">
          <span className="text-xs font-medium text-text-main/60">Median Overlap Ratio</span>
          <div className="text-xl font-bold text-text-main">
            {stats.medianOverlap === null ? '—' : `${(stats.medianOverlap * 100).toFixed(1)}%`}
          </div>
          <div className="text-[10px] text-text-main/50">Порог готовности ≥ 80.0%</div>
        </div>

        <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-1">
          <span className="text-xs font-medium text-text-main/60">Mandatory Band Drops</span>
          <div className={cn("text-xl font-bold", stats.mandatoryDropsCount === 0 ? "text-status-success" : "text-status-error")}>
            {stats.mandatoryDropsCount}
          </div>
          <div className="text-[10px] text-text-main/50">Строго 0 выпадений</div>
        </div>

        <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-1">
          <span className="text-xs font-medium text-text-main/60">P90 Budget Usage</span>
          <div className="text-xl font-bold text-text-main">{stats.p90BudgetUsage} / {stats.maxBudget} chars</div>
          <div className="text-[10px] text-text-main/50">P90 Pct: {((stats.p90BudgetUsage / stats.maxBudget) * 100).toFixed(1)}%</div>
        </div>
      </div>

      {/* Go / No-Go Readiness Banner */}
      <div className={cn(
        "p-4 rounded-2xl border flex items-center justify-between gap-3 text-xs font-medium",
        isGoNoGoMet
          ? "bg-status-success/10 border-status-success/30 text-status-success"
          : "bg-status-warning/10 border-status-warning/30 text-status-warning"
      )}>
        <div className="flex items-center gap-2">
          {isGoNoGoMet ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          <span>
            {isGoNoGoMet
              ? "Go / No-Go Bar выполнен! Сборщик готов к полному переключению блоков."
              : "Накопление данных или калибровка. Текущая выборка недостаточно велика или не достигла 80% совпадения."}
          </span>
        </div>
      </div>

      {/* Per-block Feature Flags Management */}
      <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-accent-main" />
            <h4 className="text-xs font-bold text-text-main uppercase tracking-wider">Флаги переключения блоков (Cutover Flags)</h4>
          </div>
          <Button
            onClick={handleResetFlags}
            className="px-2.5 py-1 text-[11px] font-medium text-text-main/60 hover:text-text-main bg-surface-base/40 rounded-lg border border-border-subtle"
          >
            Сбросить к дефолту
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(Object.keys(flags) as Array<keyof MemoryFeatureFlags>).map(flagKey => (
            <div
              key={flagKey}
              className="p-3 bg-surface-base/30 border border-border-subtle rounded-xl flex items-center justify-between gap-2"
            >
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-text-main font-mono">{flagKey}</div>
                <div className="text-[10px] text-text-main/60">
                  {flagKey === 'ff_memory_assembler_shadow' && 'Теневой режим (вывод без изменений)'}
                  {flagKey === 'ff_memory_assembler_chat_memory' && 'Блок 1: Память чата'}
                  {flagKey === 'ff_memory_assembler_retrieval' && 'Блок 2: Поиск RAG'}
                  {flagKey === 'ff_memory_assembler_turn1' && 'Блок 3: Turn-1 контекст'}
                  {flagKey === 'ff_memory_assembler_portrait' && 'Блок 4: Портрет пользователя'}
                </div>
              </div>

              <Button
                onClick={() => handleToggleFlag(flagKey)}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-bold transition-all duration-200",
                  flags[flagKey]
                    ? "bg-accent-main text-white shadow-sm"
                    : "bg-surface-card border border-border-subtle text-text-main/60"
                )}
              >
                {flags[flagKey] ? 'ON' : 'OFF'}
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Would Have Dropped by Category Breakdown */}
      <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-3">
        <h4 className="text-xs font-bold text-text-main uppercase tracking-wider">Отклоненные кандидаты по категориям (Would Have Dropped)</h4>
        {Object.keys(stats.wouldHaveDroppedByCategory).length === 0 ? (
          <div className="text-xs text-text-main/50 py-2">Отклоненных кандидатов не зафиксировано.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(stats.wouldHaveDroppedByCategory).map(([cat, count]) => (
              <div key={cat} className="p-2.5 bg-surface-base/30 rounded-xl border border-border-subtle flex items-center justify-between">
                <span className="text-xs font-medium text-text-main font-mono">{cat}</span>
                <span className="text-xs font-bold text-accent-main">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Journal Entries Feed */}
      <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-3">
        <h4 className="text-xs font-bold text-text-main uppercase tracking-wider">Последние записи журнала (Journal Entries)</h4>
        {entries.length === 0 ? (
          <div className="text-xs text-text-main/50 py-4 text-center">Журнал инжекции пуст. Запустите AI-чат для накопления записей.</div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {entries.map(entry => (
              <div key={entry.id} className="p-3 bg-surface-base/30 border border-border-subtle rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between text-[11px] text-text-main/60">
                  <span className="font-mono">{entry.id}</span>
                  <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-medium text-text-main">
                    Введено кандидатов: {entry.candidates.length}
                  </span>
                  {entry.shadowComparison && (
                    <span className="font-mono text-accent-main font-bold">
                      Overlap: {(entry.shadowComparison.overlapRatio * 100).toFixed(0)}%
                    </span>
                  )}
                </div>

                {entry.shadowComparison && entry.shadowComparison.wouldHaveDropped.length > 0 && (
                  <div className="text-[11px] text-status-warning bg-status-warning/10 p-2 rounded-lg">
                    <strong>Would Have Dropped:</strong> {entry.shadowComparison.wouldHaveDropped.join(' | ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
