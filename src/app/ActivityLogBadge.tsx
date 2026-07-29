import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X, Trash2, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { useActivityLogStore, ActivityLogItem } from '../shared/activity/useActivityLogStore';

// The trigger lives in the Sidebar (SidebarErrorBadge); this renders only the
// slide-out panel, driven by the store's panelOpen flag.
export const ActivityLogBadge: React.FC = () => {
  const entries = useActivityLogStore(s => s.entries);
  const clearLog = useActivityLogStore(s => s.clearLog);
  const dismissEntry = useActivityLogStore(s => s.dismissEntry);
  const isOpen = useActivityLogStore(s => s.panelOpen);
  const setIsOpen = useActivityLogStore(s => s.setPanelOpen);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<'all' | 'error'>('all');

  if (!isOpen) return null;

  const filteredEntries = filter === 'error'
    ? entries.filter(e => e.level === 'error' || e.level === 'warning')
    : entries;

  const buildReport = (): string =>
    entries
      .map((e: ActivityLogItem) => {
        const time = new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const repeats = e.count > 1 ? ` (x${e.count})` : '';
        const ctx = e.context ? `\n  ${JSON.stringify(e.context)}` : '';
        return `[${time}] ${e.level.toUpperCase()} ${e.source ?? ''}${repeats}: ${e.message}${ctx}`.trim();
      })
      .join('\n');

  const copyAll = async () => {
    const text = buildReport();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs a secure context and permission; fall back to a
      // hidden textarea so copying still works rather than failing silently.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* nothing else to try */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return timeStr;
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getIconForLevel = (level: ActivityLogItem['level']) => {
    switch (level) {
      case 'error': return <AlertCircle className="w-5 h-5 text-accent-danger" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-accent-warning" />;
      case 'success': return <CheckCircle2 className="w-5 h-5 text-accent-success" />;
      case 'info':
      default: return <Info className="w-5 h-5 text-text-muted" />;
    }
  };

  const getHeaderIcon = () => {
    const errorCount = entries.filter(e => e.level === 'error').length;
    if (errorCount > 0) return <AlertCircle className="w-5 h-5 text-accent-danger" />;
    return <Info className="w-5 h-5 text-text-muted" />;
  };

  return (
    <>
      {/* Slide-out Panel */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-start bg-black/40 backdrop-blur-xs animate-fadeIn">
          <div
            className="w-full max-w-md bg-surface-card border-r border-border-subtle shadow-2xl h-full flex flex-col overflow-hidden"
            role="dialog"
            aria-label="Журнал активности"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-border-subtle flex flex-col gap-3 bg-surface-base/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  {getHeaderIcon()}
                  <h3 className="font-semibold text-text-main text-sm">Активность ({entries.length})</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copyAll()}
                    disabled={entries.length === 0}
                    className="flex items-center gap-1 text-xs text-text-muted hover:text-text-main px-2 py-1 rounded-lg hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                    title="Скопировать весь журнал"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Скопировано' : 'Копировать'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={clearLog}
                    className="flex items-center gap-1 text-xs text-text-muted hover:text-text-main px-2 py-1 rounded-lg hover:bg-surface-elevated transition-colors"
                    title="Очистить все"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Очистить</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-elevated transition-colors"
                    aria-label="Закрыть"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className={`text-xs px-3 py-1 rounded-full transition-colors ${filter === 'all' ? 'bg-surface-elevated text-text-main' : 'text-text-muted hover:bg-surface-base'}`}
                >
                  Все события
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('error')}
                  className={`text-xs px-3 py-1 rounded-full transition-colors ${filter === 'error' ? 'bg-accent-danger/20 text-accent-danger' : 'text-text-muted hover:bg-surface-base'}`}
                >
                  Только ошибки
                </button>
              </div>
            </div>

            {/* Log List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
              {filteredEntries.map((entry: ActivityLogItem) => {
                const isExpanded = !!expandedIds[entry.id];
                const hasContext = entry.context && Object.keys(entry.context).length > 0;

                return (
                  <div
                    key={entry.id}
                    className={`p-3.5 rounded-xl border border-border-subtle bg-surface-base/80 flex flex-col gap-2 relative group ${
                      entry.level === 'error' ? 'border-accent-danger/30' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {getIconForLevel(entry.level)}
                        <span className="text-text-muted text-[11px] font-mono">
                          {formatTime(entry.time)}
                        </span>
                        {entry.source && (
                          <span className="px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted text-[10px]">
                            {entry.source}
                          </span>
                        )}
                        {entry.count > 1 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-accent-danger/20 text-accent-danger font-bold text-[10px]">
                            ×{entry.count}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => dismissEntry(entry.id)}
                        className="text-text-muted hover:text-text-main p-1 rounded hover:bg-surface-elevated transition-colors"
                        title="Удалить"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p className={`font-mono text-[11px] break-words whitespace-pre-wrap leading-relaxed select-text ${
                      entry.level === 'error' ? 'text-accent-danger font-semibold' : 'text-text-main'
                    }`}>
                      {entry.message}
                    </p>

                    {hasContext && (
                      <div className="pt-1 border-t border-border-subtle/50">
                        <button
                          type="button"
                          onClick={() => toggleExpand(entry.id)}
                          className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-main transition-colors"
                        >
                          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          <span>Детали контекста</span>
                        </button>
                        {isExpanded && (
                          <pre className="mt-2 p-2 rounded bg-surface-elevated/70 text-[10px] text-text-muted font-mono overflow-x-auto select-text max-h-36">
                            {JSON.stringify(entry.context, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredEntries.length === 0 && (
                <div className="flex flex-col items-center justify-center h-32 text-text-muted text-sm">
                  {filter === 'error' ? 'Ошибок нет' : 'Журнал пуст'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
