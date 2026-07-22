import React, { useState } from 'react';
import { AlertCircle, X, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useErrorLogStore, ErrorLogItem } from '../shared/errors/useErrorLogStore';
import { useWritingSettings } from '../features/writing/contexts/WritingSettingsContext';
import { cn } from '../core/utils/utils';

export const ErrorLogBadge: React.FC = () => {
  const entries = useErrorLogStore(s => s.entries);
  const clearLog = useErrorLogStore(s => s.clearLog);
  const dismissEntry = useErrorLogStore(s => s.dismissEntry);

  const { isZenActive, zenModeEnabled, silenceMode } = useWritingSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  if (entries.length === 0) return null;

  const isZen = isZenActive && zenModeEnabled;

  const formatErrorTime = (timestamp: number) => {
    const d = new Date(timestamp);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return timeStr;
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const errorLabel = `${entries.length} ${
    entries.length === 1 ? 'ошибка' : entries.length < 5 ? 'ошибки' : 'ошибок'
  }`;

  return (
    <>
      {/* Badge button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title={errorLabel}
        aria-label={errorLabel}
        className={cn(
          "fixed bottom-4 left-4 z-40 flex items-center gap-2 px-3 py-1.5 rounded-full",
          "bg-accent-danger/15 border border-accent-danger/30 text-accent-danger shadow-lg backdrop-blur-md",
          "hover:bg-accent-danger/25 hover:border-accent-danger/50 transition-all text-xs font-medium cursor-pointer",
          isZen ? "opacity-30 hover:opacity-100" : silenceMode ? "opacity-60 hover:opacity-100" : "opacity-100"
        )}
      >
        <AlertCircle className="w-3.5 h-3.5" />
        <span>{entries.length}</span>
      </button>

      {/* Slide-out Panel */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-start bg-black/40 backdrop-blur-xs animate-fadeIn">
          <div
            className="w-full max-w-md bg-surface-card border-r border-border-subtle shadow-2xl h-full flex flex-col overflow-hidden"
            role="dialog"
            aria-label="Журнал ошибок"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between bg-surface-base/50">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-5 h-5 text-accent-danger" />
                <h3 className="font-semibold text-text-main text-sm">Журнал ошибок ({entries.length})</h3>
              </div>
              <div className="flex items-center gap-2">
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

            {/* Error List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
              {entries.map((entry: ErrorLogItem) => {
                const isExpanded = !!expandedIds[entry.id];
                const hasContext = entry.context && Object.keys(entry.context).length > 0;

                return (
                  <div
                    key={entry.id}
                    className="p-3.5 rounded-xl border border-border-subtle bg-surface-base/80 text-xs flex flex-col gap-2 relative group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-text-muted text-[11px] font-mono">
                          {formatErrorTime(entry.time)}
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

                    <p className="text-text-main font-mono text-[11px] break-words whitespace-pre-wrap leading-relaxed select-text">
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
            </div>
          </div>
        </div>
      )}
    </>
  );
};
