import { useState, useEffect } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { getLocalDb, type LifeStoryEntry } from '../../../core/storage/localDb';
import { LifeStoryService } from '../services/LifeStoryService';
import { reportError } from '../../../shared/errors/reportError';

interface DayItem {
  eventDate: string;
  documentId: string;
  noteTitle: string;
  timelineSummary?: string | undefined;
  storyEntry?: LifeStoryEntry | undefined;
  facts?: string[] | undefined;
  themes?: string[] | undefined;
}

function getTeaser(text: string | undefined): string {
  if (!text) return '';
  const firstSentence = text.split(/[.!?]\s/)[0];
  if (firstSentence && firstSentence.length < text.length) {
    return firstSentence + '.';
  }
  if (text.length > 80) {
    return text.slice(0, 80) + '...';
  }
  return text;
}

export function LifeStoryTimeline() {
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<DayItem[]>([]);
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});

  const toggleDateExpanded = (date: string) => {
    setExpandedDates(prev => ({ ...prev, [date]: !prev[date] }));
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const db = await getLocalDb();
      const timelineEntries = await db.getAll('aiTimeline');
      const docs = await db.getAll('documents');
      const docMap = new Map(docs.map(d => [d.id, d]));
      const storyEntries = await LifeStoryService.getAll();
      const storyMap = new Map(storyEntries.map(s => [s.eventDate, s]));

      // Map timeline entries to event dates. Reuse the note's existing AI summary
      // directly as the day's story — no separate generation needed.
      const dayMap = new Map<string, { documentId: string; noteTitle: string; timelineSummary?: string | undefined; facts?: string[] | undefined; themes?: string[] | undefined }>();
      for (const entry of timelineEntries) {
        const eventDate = LifeStoryService.getDefaultEventDate(entry.date);
        const doc = docMap.get(entry.documentId);
        dayMap.set(eventDate, {
          documentId: entry.documentId,
          noteTitle: doc?.title || 'Заметка без названия',
          timelineSummary: entry.summary,
          facts: entry.facts,
          themes: entry.themes,
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
        timelineSummary: info.timelineSummary,
        storyEntry: storyMap.get(eventDate),
        facts: info.facts,
        themes: info.themes,
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
              const entry = item.storyEntry;
              const fullText = entry?.text || item.timelineSummary;
              const hasText = Boolean(fullText);
              const isExpanded = expandedDates[item.eventDate] || false;
              const teaser = getTeaser(fullText);
              const hasFacts = item.facts && item.facts.length > 0;
              const canExpand = hasText && ((fullText && fullText.length > teaser.length) || hasFacts);

              return (
                <div key={item.eventDate} className="relative pl-6">
                  {/* Timeline node */}
                  <span className="absolute -left-[6.5px] top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-elevated border border-border-subtle">
                    <span className={`h-1.5 w-1.5 rounded-full ${hasText ? 'bg-brand-soft shadow-[0_0_4px_var(--brand-soft)]' : 'bg-text-main/30'}`} />
                  </span>

                  <div className="space-y-1.5">
                    {/* Date */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-text-main">
                          {new Date(item.eventDate).toLocaleDateString('ru-RU', {
                            day: '2-digit',
                            month: 'long',
                            year: 'numeric',
                          })}
                        </span>
                        {entry?.edited && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">изменено</span>
                        )}
                      </div>
                    </div>

                    {/* Text container */}
                    <div className="bg-surface-card/25 border border-border-subtle/50 rounded-xl p-3 text-xs leading-relaxed text-text-main/80">
                      {!hasText ? (
                        <div className="flex items-center gap-1.5 text-text-main/50 italic py-0.5">
                          <AlertCircle size={12} className="text-text-main/40" />
                          Нет описания для этого дня
                        </div>
                      ) : !isExpanded ? (
                        <div className="space-y-2">
                          <span className="text-text-main/80">{teaser}</span>
                          {canExpand && (
                            <button
                              type="button"
                              onClick={() => toggleDateExpanded(item.eventDate)}
                              className="text-brand-soft hover:underline focus:outline-none ml-1.5 font-medium cursor-pointer animate-none bg-transparent border-0 p-0"
                            >
                              развернуть
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div>
                            <span className="text-text-main/80">{fullText}</span>
                            {canExpand && (
                              <button
                                type="button"
                                onClick={() => toggleDateExpanded(item.eventDate)}
                                className="text-brand-soft hover:underline focus:outline-none ml-1.5 font-medium cursor-pointer animate-none bg-transparent border-0 p-0"
                              >
                                свернуть
                              </button>
                            )}
                          </div>
                          {hasFacts && (
                            <div className="mt-2.5 pt-2.5 border-t border-border-subtle/30 space-y-1.5">
                              <div className="text-[10px] font-mono uppercase tracking-wider text-text-main/50">Факты и инсайты:</div>
                              <ul className="list-disc pl-4 space-y-1 text-text-main/70">
                                {item.facts!.map((fact, idx) => (
                                  <li key={idx}>{fact}</li>
                                ))}
                              </ul>
                            </div>
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
