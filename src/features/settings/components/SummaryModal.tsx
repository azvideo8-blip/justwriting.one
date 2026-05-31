import { Sparkles, X } from 'lucide-react';
import type { AIDocumentSummary } from '../../../core/storage/localDb';

interface SummaryModalProps {
  summary: AIDocumentSummary | null;
  onClose: () => void;
}

export function SummaryModal({ summary, onClose }: SummaryModalProps) {
  if (summary === null) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-lg mx-4 bg-surface-card border border-border-subtle rounded-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h3 className="text-base font-bold text-text-main flex items-center gap-2">
            <Sparkles size={16} className="text-brand-soft" />
            ИИ Анализ Документа
          </h3>
          <button onClick={onClose} className="p-2 rounded-lg text-text-main/40 hover:text-text-main transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-4 text-sm text-text-main/80">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-text-main/40">Тональность</span>
            <p className="mt-1 text-sm font-medium text-text-main capitalize">{summary.tone}</p>
          </div>

          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-text-main/40">Ключевые слова</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {summary.frequentWords.map(word => (
                <span key={word} className="px-2 py-0.5 text-xs bg-surface-base/10 rounded-md border border-border-subtle text-text-main/70">
                  {word}
                </span>
              ))}
            </div>
          </div>

          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-text-main/40">Основные темы</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {summary.themes.map(theme => (
                <span key={theme} className="px-2 py-0.5 text-xs bg-brand-soft/5 rounded-md border border-brand-soft/10 text-brand-soft font-medium">
                  {theme}
                </span>
              ))}
            </div>
          </div>

          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-text-main/40">Ключевые мысли и инсайты</span>
            <ul className="mt-2 list-disc list-inside space-y-1.5 pl-1">
              {summary.insights.map((insight, idx) => (
                <li key={idx} className="text-xs text-text-main/70 leading-relaxed pl-1">
                  {insight}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="px-6 py-3.5 border-t border-border-subtle flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-text-main text-surface-base text-xs font-medium hover:bg-text-main/90 transition-colors">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
