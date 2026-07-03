import { useState, useEffect, useCallback } from 'react';
import { Brain, X, Trash2 } from 'lucide-react';
import { AIChatMemoryService } from '../services/AIChatMemoryService';
import type { AIChatMemory } from '../../../core/storage/localDb';
import { useLanguage } from '../../../shared/i18n';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';

const KIND_ORDER: AIChatMemory['kind'][] = ['preference', 'fact', 'insight', 'commitment'];

const KIND_BADGE_STYLES: Record<AIChatMemory['kind'], string> = {
  preference: 'bg-brand-soft/10 text-brand-soft border-brand-soft/25',
  fact: 'bg-surface-base/10 text-text-main/70 border-border-subtle',
  insight: 'bg-accent-info/10 text-accent-info border-accent-info/25',
  commitment: 'bg-accent-success/10 text-accent-success border-accent-success/25',
};

interface MemoryManagerModalProps {
  onClose: () => void;
}

export function MemoryManagerModal({ onClose }: MemoryManagerModalProps) {
  const { t } = useLanguage();
  const { confirm: confirmDialog } = useConfirmDialog();
  const [memories, setMemories] = useState<AIChatMemory[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    try {
      const all = await AIChatMemoryService.getAll();
      setMemories(all.sort((a, b) => b.createdAt - a.createdAt));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  const handleDelete = async (id: string) => {
    setMemories(prev => prev.filter(m => m.id !== id));
    try {
      await AIChatMemoryService.delete(id);
    } catch {
      void loadMemories();
    }
  };

  const handleForgetAll = async () => {
    const ok = await confirmDialog({
      title: t('ai_memory_forget_all'),
      message: t('ai_memory_forget_all_confirm'),
    });
    if (!ok) return;
    await AIChatMemoryService.deleteAll();
    setMemories([]);
  };

  const grouped = KIND_ORDER.map(kind => ({
    kind,
    items: memories.filter(m => m.kind === kind),
  })).filter(g => g.items.length > 0);

  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md mx-4 bg-surface-card border border-border-subtle rounded-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h3 className="text-base font-bold text-text-main flex items-center gap-2">
            <Brain size={16} className="text-brand-soft" />
            {t('ai_memory_title')}
          </h3>
          <IconButton onClick={onClose} className="p-2 rounded-lg text-text-main/60 hover:text-text-main transition-colors" label={t('common_close')} icon={<X size={18} />} />
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="py-8 text-center text-xs text-text-main/60">
              {t('ai_processing')}
            </div>
          ) : grouped.length === 0 ? (
            <div className="py-12 text-center text-sm text-text-main/60">
              {t('ai_memory_empty')}
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(({ kind, items }) => (
                <div key={kind}>
                  <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-text-main/60 mb-2.5">
                    {t(`ai_memory_kind_${kind}`)}
                  </div>
                  <div className="space-y-2">
                    {items.map(m => (
                      <div
                        key={m.id}
                        className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-surface-base/5 border border-border-subtle/50"
                      >
                        <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase border ${KIND_BADGE_STYLES[m.kind]}`}>
                          {t(`ai_memory_kind_${m.kind}`)}
                        </span>
                        <span className="flex-1 min-w-0 text-sm text-text-main/80 leading-snug">
                          {m.text}
                        </span>
                        <IconButton
                          onClick={() => void handleDelete(m.id)}
                          className="shrink-0 p-1 rounded-lg text-text-main/30 hover:text-accent-danger transition-colors"
                          label={t('ai_memory_delete')}
                          icon={<Trash2 size={14} />}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {memories.length > 0 && (
          <div className="px-6 py-3.5 border-t border-border-subtle flex justify-end">
            <Button
              onClick={() => void handleForgetAll()}
              className="px-4 py-2 rounded-xl bg-accent-danger/10 border border-accent-danger/25 text-accent-danger text-xs font-medium hover:bg-accent-danger/20 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Trash2 size={13} />
                {t('ai_memory_forget_all')}
              </span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
