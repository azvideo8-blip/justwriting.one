import { useState, useEffect } from 'react';
import { InjectionJournal, JournalEntry, JournalStats } from '../services/injectionJournal';
import { MemoryFlagsService, MemoryFeatureFlags } from '../services/memoryFlags';
import { Button } from '../../../shared/components/Button';
import { cn } from '../../../core/utils/utils';
import { Sparkles, CheckCircle, AlertTriangle, RefreshCw, Trash2, Layers } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';

export function MemoryAssemblerDiagnostics() {
  const { t } = useLanguage();
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch from IndexedDB on mount
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
            <Sparkles className="w-5 h-5 text-accent" />
            <h3 className="text-sm font-bold text-text-main">{t('admin_memory_diag_title')}</h3>
          </div>
          <p className="text-xs text-text-main/60 mt-1">
            {t('admin_memory_diag_desc')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => void refreshData()}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-surface-base/60 text-text-main border border-border-subtle flex items-center gap-1.5"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            {t('admin_refresh')}
          </Button>
          <Button
            onClick={handleClearJournal}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-status-error/10 text-status-error border border-status-error/20 flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('admin_memory_clear_log')}
          </Button>
        </div>
      </div>

      {/* Executive Go/No-Go Bar Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-1">
          <span className="text-xs font-medium text-text-main/60">{t('admin_memory_stat_total_turns')}</span>
          <div className="text-xl font-bold text-text-main">{stats.totalTurns} / 100</div>
          <div className="text-[10px] text-text-main/50">{t('admin_memory_stat_turns_threshold')}</div>
        </div>

        <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-1">
          <span className="text-xs font-medium text-text-main/60">Median Overlap Ratio</span>
          <div className="text-xl font-bold text-text-main">
            {stats.medianOverlap === null ? '—' : `${(stats.medianOverlap * 100).toFixed(1)}%`}
          </div>
          <div className="text-[10px] text-text-main/50">{t('admin_memory_stat_overlap_threshold')}</div>
        </div>

        <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-1">
          <span className="text-xs font-medium text-text-main/60">{t('admin_memory_stat_mandatory_drops')}</span>
          <div className={cn("text-xl font-bold", stats.mandatoryDropsCount === 0 ? "text-status-success" : "text-status-error")}>
            {stats.mandatoryDropsCount}
          </div>
          <div className="text-[10px] text-text-main/50">{t('admin_memory_stat_drops_zero')}</div>
        </div>

        <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-1">
          <span className="text-xs font-medium text-text-main/60">{t('admin_memory_stat_p90_usage')}</span>
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
              ? t('admin_memory_status_go')
              : t('admin_memory_status_nogo')}
          </span>
        </div>
      </div>

      {/* Per-block Feature Flags Management */}
      <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-accent" />
            <h4 className="text-xs font-bold text-text-main uppercase tracking-wider">{t('admin_memory_flags_title')}</h4>
          </div>
          <Button
            onClick={handleResetFlags}
            className="px-2.5 py-1 text-[11px] font-medium text-text-main/60 hover:text-text-main bg-surface-base/40 rounded-lg border border-border-subtle"
          >
            {t('admin_memory_reset_flags')}
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
                  {flagKey === 'ff_memory_assembler_shadow' && t('admin_memory_flag_shadow')}
                  {flagKey === 'ff_memory_assembler_chat_memory' && t('admin_memory_flag_chat_memory')}
                  {flagKey === 'ff_memory_assembler_retrieval' && t('admin_memory_flag_retrieval')}
                  {flagKey === 'ff_memory_assembler_turn1' && t('admin_memory_flag_turn1')}
                  {flagKey === 'ff_memory_assembler_portrait' && t('admin_memory_flag_portrait')}
                  {flagKey === 'ff_memory_assembler_beliefs' && t('admin_memory_flag_beliefs')}
                </div>
              </div>

              <Button
                onClick={() => handleToggleFlag(flagKey)}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-bold transition-all duration-200",
                  flags[flagKey]
                    ? "bg-accent text-white shadow-sm"
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
        <h4 className="text-xs font-bold text-text-main uppercase tracking-wider">{t('admin_memory_dropped_title')}</h4>
        {Object.keys(stats.wouldHaveDroppedByCategory).length === 0 ? (
          <div className="text-xs text-text-main/50 py-2">{t('admin_memory_dropped_empty')}</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(stats.wouldHaveDroppedByCategory).map(([cat, count]) => (
              <div key={cat} className="p-2.5 bg-surface-base/30 rounded-xl border border-border-subtle flex items-center justify-between">
                <span className="text-xs font-medium text-text-main font-mono">{cat}</span>
                <span className="text-xs font-bold text-accent">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Journal Entries Feed */}
      <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-3">
        <h4 className="text-xs font-bold text-text-main uppercase tracking-wider">{t('admin_memory_journal_title')}</h4>
        {entries.length === 0 ? (
          <div className="text-xs text-text-main/50 py-4 text-center">{t('admin_memory_journal_empty')}</div>
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
                    {t('admin_memory_candidates_in', { count: entry.candidates.length })}
                  </span>
                  {entry.shadowComparison && (
                    <span className="font-mono text-accent font-bold">
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
