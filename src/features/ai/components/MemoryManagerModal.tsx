import { useState, useEffect, useCallback } from 'react';
import { Brain, X, Trash2 } from 'lucide-react';
import { AIChatMemoryService } from '../services/AIChatMemoryService';
import type { AIChatMemory, AIPeopleIndexEntry } from '../../../core/storage/localDb';
import { useLanguage } from '../../../shared/i18n';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { AIPeopleService } from '../services/AIPeopleService';

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
  const [activeTab, setActiveTab] = useState<'memories' | 'people'>('memories');
  const [people, setPeople] = useState<AIPeopleIndexEntry[]>([]);
  const [expandedPersonKey, setExpandedPersonKey] = useState<string | null>(null);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    try {
      const all = await AIChatMemoryService.getAll();
      setMemories(all.sort((a, b) => b.createdAt - a.createdAt));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPeople = useCallback(async () => {
    try {
      const all = await AIPeopleService.getAll();
      setPeople(all);
    } catch (e) {
      console.error('[MemoryManagerModal] failed to load people:', e);
    }
  }, []);

  useEffect(() => {
    void loadMemories();
    void loadPeople();
  }, [loadMemories, loadPeople]);

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

  const handleToggleStatus = async (person: AIPeopleIndexEntry, newStatus: 'active' | 'ignored') => {
    try {
      await AIPeopleService.updateStatus(person.key, person.name, newStatus);
      await loadPeople();
    } catch (e) {
      console.error('[MemoryManagerModal] failed to toggle status:', e);
    }
  };

  const handleForgetPerson = async (key: string) => {
    const ok = await confirmDialog({
      title: 'Удалить из памяти?',
      message: 'Имя и статус этого человека будут удалены из индекса памяти. Вы уверены?',
    });
    if (!ok) return;
    try {
      await AIPeopleService.delete(key);
      setExpandedPersonKey(null);
      await loadPeople();
    } catch (e) {
      console.error('[MemoryManagerModal] failed to forget person:', e);
    }
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

        <div className="flex border-b border-border-subtle px-6">
          <button
            type="button"
            onClick={() => setActiveTab('memories')}
            className={`py-3 px-1 text-xs font-semibold border-b-2 transition-colors cursor-pointer mr-6 ${
              activeTab === 'memories'
                ? 'border-brand-soft text-brand-soft'
                : 'border-transparent text-text-main/60 hover:text-text-main'
            }`}
          >
            Факты и правила
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('people')}
            className={`py-3 px-1 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'people'
                ? 'border-brand-soft text-brand-soft'
                : 'border-transparent text-text-main/60 hover:text-text-main'
            }`}
          >
            Упоминания людей
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {activeTab === 'memories' ? (
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
            )
          ) : (
            people.length === 0 ? (
              <div className="py-12 text-center text-sm text-text-main/60">
                Нет сохраненных имен в памяти
              </div>
            ) : (
              <div className="space-y-2">
                {people.map(p => {
                  const isExpanded = expandedPersonKey === p.key;
                  const statusColors = {
                    active: 'text-accent-success bg-accent-success/10 border-accent-success/20',
                    ignored: 'text-text-main/50 bg-text-main/5 border-border-subtle',
                    pending: 'text-accent-warning bg-accent-warning/10 border-accent-warning/20',
                  };
                  const statusText = {
                    active: 'Отслеживается',
                    ignored: 'Игнорируется',
                    pending: 'На рассмотрении',
                  };
                  const status = p.status || 'pending';

                  return (
                    <div
                      key={p.key}
                      className="px-3.5 py-3 rounded-xl bg-surface-base/5 border border-border-subtle/50 flex flex-col gap-2.5 transition-all"
                    >
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => setExpandedPersonKey(isExpanded ? null : p.key)}
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-semibold text-text-main">
                            {p.name}
                          </span>
                          <span className="text-[10px] text-text-main/50">
                            упоминаний: {p.mentionCount || p.noteIds.length}
                          </span>
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusColors[status]}`}>
                          {statusText[status]}
                        </span>
                      </div>

                      {isExpanded && (
                        <div className="pt-2.5 border-t border-border-subtle/30 flex flex-col gap-3 animate-in slide-in-from-top-1 duration-150">
                          {p.role ? (
                            <div className="text-xs text-text-main/70 leading-relaxed bg-surface-base/10 px-2.5 py-2 rounded-lg">
                              <span className="font-semibold text-text-main/90">Описание/Роль:</span> {p.role}
                            </div>
                          ) : (
                            <div className="text-xs text-text-main/40 italic">
                              Роль или описание не определены
                            </div>
                          )}

                          <div className="flex items-center gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => void handleToggleStatus(p, 'active')}
                              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                                status === 'active'
                                  ? 'bg-accent-success text-white border-transparent'
                                  : 'bg-transparent text-text-main/60 border-border-subtle hover:bg-text-main/5'
                              }`}
                            >
                              Отслеживать
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleToggleStatus(p, 'ignored')}
                              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                                status === 'ignored'
                                  ? 'bg-text-main text-surface-card border-transparent'
                                  : 'bg-transparent text-text-main/60 border-border-subtle hover:bg-text-main/5'
                              }`}
                            >
                              Игнорировать
                            </button>
                            <IconButton
                              onClick={() => void handleForgetPerson(p.key)}
                              className="p-1.5 rounded-lg border border-border-subtle text-text-main/40 hover:text-accent-danger hover:border-accent-danger/25 transition-all cursor-pointer"
                              label="Забыть человека"
                              icon={<Trash2 size={14} />}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        {activeTab === 'memories' && memories.length > 0 && (
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
