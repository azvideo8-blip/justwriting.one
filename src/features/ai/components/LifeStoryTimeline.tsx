import { useState, useEffect } from 'react';
import { Loader2, Sparkles, Pencil, Check, X, AlertCircle } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { getLocalDb, type LifeStoryEntry } from '../../../core/storage/localDb';
import { LifeStoryService } from '../services/LifeStoryService';
import { useToast } from '../../../shared/components/Toast';
import { reportError } from '../../../shared/errors/reportError';

interface DayItem {
  eventDate: string;
  documentId: string;
  noteTitle: string;
  storyEntry?: LifeStoryEntry | undefined;
}

export function LifeStoryTimeline() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<DayItem[]>([]);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editEventDate, setEditEventDate] = useState('');
  const [generatingDate, setGeneratingDate] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const db = await getLocalDb();
      const timelineEntries = await db.getAll('aiTimeline');
      const docs = await db.getAll('documents');
      const docMap = new Map(docs.map(d => [d.id, d]));
      const storyEntries = await LifeStoryService.getAll();
      const storyMap = new Map(storyEntries.map(s => [s.eventDate, s]));

      // Map timeline entries to event dates
      const dayMap = new Map<string, { documentId: string; noteTitle: string }>();
      for (const entry of timelineEntries) {
        const eventDate = LifeStoryService.getDefaultEventDate(entry.date);
        const doc = docMap.get(entry.documentId);
        dayMap.set(eventDate, {
          documentId: entry.documentId,
          noteTitle: doc?.title || 'Заметка без названия',
        });
      }

      // Add any custom story entries that don't have matching timeline entries
      for (const entry of storyEntries) {
        if (!dayMap.has(entry.eventDate)) {
          dayMap.set(entry.eventDate, {
            documentId: entry.sourceDocumentIds[0] || '',
            noteTitle: 'Вручную добавленное событие',
          });
        }
      }

      // Compile days list sorted descending
      const compiledDays: DayItem[] = Array.from(dayMap.entries()).map(([eventDate, info]) => ({
        eventDate,
        documentId: info.documentId,
        noteTitle: info.noteTitle,
        storyEntry: storyMap.get(eventDate),
      })).sort((a, b) => b.eventDate.localeCompare(a.eventDate));

      setDays(compiledDays);
    } catch (e) {
      console.error('[LifeStoryTimeline] failed to load life story:', e);
      reportError(e, { action: 'life_story_timeline_load' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleStartEdit = (item: DayItem) => {
    setEditingDate(item.eventDate);
    setEditText(item.storyEntry?.text || '');
    setEditEventDate(item.eventDate);
  };

  const handleCancelEdit = () => {
    setEditingDate(null);
  };

  const handleSaveEdit = async (item: DayItem) => {
    if (!editText.trim()) {
      showToast('Описание события не может быть пустым', 'error');
      return;
    }

    try {


      // If the eventDate itself was changed
      if (editEventDate !== item.eventDate) {
        // Verify target event date doesn't exist already
        const existing = await LifeStoryService.get(editEventDate);
        if (existing) {
          showToast('Событие на эту дату уже существует', 'error');
          return;
        }

        // Delete old entry
        await LifeStoryService.delete(item.eventDate);
      }

      await LifeStoryService.save({
        eventDate: editEventDate,
        text: editText,
        sourceDocumentIds: item.storyEntry?.sourceDocumentIds || [item.documentId],
        generatedAt: item.storyEntry?.generatedAt || Date.now(),
        edited: true,
      });

      showToast('Событие сохранено', 'success');
      setEditingDate(null);
      await loadData();
    } catch (e) {
      reportError(e, { action: 'life_story_timeline_save' });
      showToast('Не удалось сохранить изменения', 'error');
    }
  };

  const handleGenerate = async (item: DayItem) => {
    if (!item.documentId) {
      showToast('Нет связанного документа для суммаризации', 'error');
      return;
    }
    setGeneratingDate(item.eventDate);
    try {
      await LifeStoryService.generateWithAI(item.eventDate, item.documentId);
      showToast('Описание дня сгенерировано', 'success');
      await loadData();
    } catch (e) {
      reportError(e, { action: 'life_story_timeline_generate' });
      showToast(e instanceof Error ? e.message : 'Ошибка генерации', 'error');
    } finally {
      setGeneratingDate(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 size={16} className="animate-spin text-text-main/60" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-surface-base/5 border border-border-subtle overflow-hidden">
      <div className="px-5 py-3 border-b border-border-subtle">
        <span className="text-xs font-bold text-text-main/60 uppercase tracking-wider">История моей жизни (по дням)</span>
      </div>

      <div className="p-5 space-y-6">
        {days.length === 0 ? (
          <div className="text-center py-8 text-xs text-text-main/60 italic">
            История жизни пока пуста. Напишите и проанализируйте заметки, чтобы они появились здесь.
          </div>
        ) : (
          <div className="relative border-l border-border-subtle ml-3 space-y-6">
            {days.map(item => {
              const isEditing = editingDate === item.eventDate;
              const isGenerating = generatingDate === item.eventDate;
              const entry = item.storyEntry;

              return (
                <div key={item.eventDate} className="relative pl-6">
                  {/* Timeline node */}
                  <span className="absolute -left-[6.5px] top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-elevated border border-border-subtle">
                    <span className={`h-1.5 w-1.5 rounded-full ${entry ? 'bg-brand-soft shadow-[0_0_4px_var(--brand-soft)]' : 'bg-text-main/30'}`} />
                  </span>

                  <div className="space-y-1.5">
                    {/* Date and actions */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <input
                            type="date"
                            value={editEventDate}
                            onChange={e => setEditEventDate(e.target.value)}
                            className="bg-surface-elevated border border-border-subtle text-xs rounded-lg px-2 py-0.5 outline-none text-text-main"
                          />
                        ) : (
                          <span className="text-xs font-mono font-semibold text-text-main">
                            {new Date(item.eventDate).toLocaleDateString('ru-RU', {
                              day: '2-digit',
                              month: 'long',
                              year: 'numeric',
                            })}
                          </span>
                        )}
                        {entry?.edited && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">изменено</span>
                        )}
                      </div>

                      {!isEditing && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleStartEdit(item)}
                            className="p-1 text-text-main/40 hover:text-brand-soft hover:bg-surface-elevated rounded transition-colors"
                            title="Редактировать событие"
                          >
                            <Pencil size={11} />
                          </button>
                          {item.documentId && (
                            <button
                              onClick={() => void handleGenerate(item)}
                              disabled={isGenerating}
                              className="p-1 text-text-main/40 hover:text-brand-soft hover:bg-surface-elevated rounded transition-colors disabled:opacity-50"
                              title="Перегенерировать описание с ИИ"
                            >
                              {isGenerating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Text container */}
                    <div className="bg-surface-card/25 border border-border-subtle/50 rounded-xl p-3 text-xs leading-relaxed text-text-main/80">
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            rows={2}
                            className="w-full bg-transparent border-0 outline-none resize-none p-0 text-xs text-text-main placeholder:text-text-main/40"
                            placeholder="Опишите, что произошло в этот день..."
                          />
                          <div className="flex justify-end gap-1.5 pt-1 border-t border-border-subtle/30">
                            <Button
                              onClick={handleCancelEdit}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-subtle text-[10px] font-bold text-text-main/60 hover:bg-surface-elevated"
                            >
                              <X size={10} /> Отмена
                            </Button>
                            <Button
                              onClick={() => void handleSaveEdit(item)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-soft text-surface-card text-[10px] font-bold hover:bg-brand-soft/90"
                            >
                              <Check size={10} /> Сохранить
                            </Button>
                          </div>
                        </div>
                      ) : entry ? (
                        <span>{entry.text}</span>
                      ) : (
                        <div className="flex items-center justify-between gap-3 text-text-main/50 italic py-0.5">
                          <span className="flex items-center gap-1.5">
                            <AlertCircle size={12} className="text-text-main/40" />
                            Нет описания для этого дня
                          </span>
                          {item.documentId && (
                            <Button
                              onClick={() => void handleGenerate(item)}
                              disabled={isGenerating}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-brand-soft/20 bg-brand-soft/5 text-brand-soft text-[10px] font-bold hover:bg-brand-soft/10 disabled:opacity-50"
                            >
                              {isGenerating ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                              Сгенерировать
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
