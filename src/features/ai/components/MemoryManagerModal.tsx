import { useState, useEffect, useCallback } from 'react';
import { Brain, X, Trash2, Undo2 } from 'lucide-react';
import { AIChatMemoryService, isUnreviewedLegacyMemory } from '../services/AIChatMemoryService';
import type { AIChatMemory } from '../../../core/storage/localDb';
import { useLanguage } from '../../../shared/i18n';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { ModalShell } from '../../../shared/components/ModalShell';

const KIND_ORDER: AIChatMemory['kind'][] = ['preference', 'fact', 'insight', 'commitment'];

const KIND_ACCENT: Record<AIChatMemory['kind'], string> = {
  preference: 'border-l-brand-soft/40',
  fact: 'border-l-border-subtle',
  insight: 'border-l-accent-info/40',
  commitment: 'border-l-accent-success/40',
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount
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

  // Решение владельца 2026-10-20 (AP-2, «в»): старая память без источника ИИ не
  // уходит, пока человек не вернул её в контекст.
  const handleReturn = async (id: string) => {
    setMemories(prev => prev.map(m => (m.id === id ? { ...m, reviewedAt: Date.now() } : m)));
    try {
      await AIChatMemoryService.markReviewed(id);
    } catch {
      void loadMemories();
    }
  };

  const unreviewedCount = memories.filter(isUnreviewedLegacyMemory).length;

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
    <ModalShell
      open
      onClose={onClose}
      labelId="memory-manager-title"
      className="mx-4 bg-surface-card border border-border-subtle rounded-2xl shadow-2xl max-h-[85vh] flex flex-col"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
        <h3 id="memory-manager-title" className="text-base font-bold text-text-main flex items-center gap-2">
            <Brain size={16} className="text-brand-soft" />
            {t('ai_memory_title')}
          </h3>
          <IconButton onClick={onClose} className="p-2 rounded-lg text-text-main/60 hover:text-text-main transition-colors" label={t('common_close')} icon={<X size={18} />} />
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {
            loading ? (
              <div className="py-8 text-center text-xs text-text-main/60">
                {t('ai_processing')}
              </div>
            ) : grouped.length === 0 ? (
              <div className="py-12 text-center text-sm text-text-main/60">
                {t('ai_memory_empty')}
              </div>
            ) : (
              <div className="space-y-5">
                {unreviewedCount > 0 && (
                  <p data-testid="memory-unreviewed-hint" className="text-xs leading-snug text-text-main/60">
                    {t('ai_memory_unreviewed_hint')}
                  </p>
                )}
                {grouped.map(({ kind, items }) => (
                  <div key={kind}>
                    <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-text-main/60 mb-2.5">
                      {t(`ai_memory_kind_${kind}`)}
                    </div>
                    <div className="space-y-2">
                      {items.map(m => (
                        <div
                          key={m.id}
                          className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-surface-base/5 border border-l-2 border-border-subtle/50 ${KIND_ACCENT[m.kind]}`}
                        >
                          <span className="flex-1 min-w-0 text-sm text-text-main/80 leading-snug">
                            {m.text}
                            {isUnreviewedLegacyMemory(m) && (
                              <span data-testid="memory-unknown-source" className="mt-1 block text-xs text-text-main/60">
                                {t('ai_memory_unknown_source')}
                              </span>
                            )}
                          </span>
                          {isUnreviewedLegacyMemory(m) && (
                            <IconButton
                              onClick={() => void handleReturn(m.id)}
                              className="shrink-0 p-1 rounded-lg text-text-main/60 hover:text-text-main transition-colors"
                              label={t('ai_memory_return')}
                              title={t('ai_memory_return')}
                              icon={<Undo2 size={14} />}
                            />
                          )}
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
    </ModalShell>
  );
}
