import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, ChevronDown } from 'lucide-react';
import { getLocalDb, type LifeStoryEntry } from '../../../core/storage/localDb';
import { LifeStoryService } from '../services/LifeStoryService';
import { reportError } from '../../../shared/errors/reportError';
import { cn } from '../../../core/utils/utils';

interface DayNote {
  documentId: string;
  noteTitle: string;
  summary?: string | undefined;
}

interface DayItem {
  eventDate: string;
  notes: DayNote[];
  storyEntry?: LifeStoryEntry | undefined;
  facts: string[];
  themes: string[];
  insights: string[];
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

      // Group timeline entries by eventDate into arrays per day
      const dayMap = new Map<string, {
        notes: DayNote[];
        facts: Set<string>;
        themes: Set<string>;
        insights: Set<string>;
      }>();

      for (const entry of timelineEntries) {
        const eventDate = entry.eventDate ?? entry.date ?? LifeStoryService.getDefaultEventDate(entry.date);
        const doc = docMap.get(entry.documentId);
        
        let dayData = dayMap.get(eventDate);
        if (!dayData) {
          dayData = {
            notes: [],
            facts: new Set<string>(),
            themes: new Set<string>(),
            insights: new Set<string>(),
          };
          dayMap.set(eventDate, dayData);
        }

        dayData.notes.push({
          documentId: entry.documentId,
          noteTitle: doc?.title || 'Заметка без названия',
          summary: entry.summary,
        });

        if (entry.facts !== undefined) {
          for (const f of entry.facts) if (f) dayData.facts.add(f);
        }
        if (entry.themes !== undefined) {
          for (const t of entry.themes) if (t) dayData.themes.add(t);
        }
        if (entry.insights !== undefined) {
          for (const ins of entry.insights) if (ins) dayData.insights.add(ins);
        }
      }

      // Add any custom story entries that don't have matching timeline entries
      for (const entry of storyEntries) {
        if (!dayMap.has(entry.eventDate)) {
          dayMap.set(entry.eventDate, {
            notes: [{
              documentId: entry.sourceDocumentIds[0] || '',
              noteTitle: 'Вручную добавленное событие',
            }],
            facts: new Set<string>(),
            themes: new Set<string>(),
            insights: new Set<string>(),
          });
        }
      }

      // Compile days list sorted descending
      const compiledDays: DayItem[] = Array.from(dayMap.entries()).map(([eventDate, info]) => ({
        eventDate,
        notes: info.notes,
        storyEntry: storyMap.get(eventDate),
        facts: Array.from(info.facts),
        themes: Array.from(info.themes),
        insights: Array.from(info.insights),
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
              const isExpanded = expandedDates[item.eventDate] || false;
              const hasFacts = item.facts.length > 0;
              const hasInsights = item.insights.length > 0;
              const hasDetails = hasFacts || hasInsights;
              const hasNotes = item.notes.length > 0;
              const mainText = entry?.text;

              return (
                <div key={item.eventDate} className="relative pl-6">
                  {/* Timeline node */}
                  <span className="absolute -left-[6.5px] top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-elevated border border-border-subtle">
                    <span className={`h-1.5 w-1.5 rounded-full ${mainText || hasNotes ? 'bg-brand-soft shadow-[0_0_4px_var(--brand-soft)]' : 'bg-text-main/30'}`} />
                  </span>

                  <div className="space-y-1.5">
                    {/* Date and Toggle */}
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
                      {hasDetails && (
                        <button
                          type="button"
                          onClick={() => toggleDateExpanded(item.eventDate)}
                          className="p-1 text-text-main/40 hover:text-brand-soft hover:bg-surface-elevated rounded transition-all cursor-pointer focus:outline-none"
                          title={isExpanded ? 'Свернуть детали' : 'Развернуть детали'}
                        >
                          <ChevronDown size={14} className={cn('transition-transform duration-200', isExpanded && 'rotate-180')} />
                        </button>
                      )}
                    </div>

                    {/* Text container */}
                    <div className="bg-surface-card/25 border border-border-subtle/50 rounded-xl p-3 text-xs leading-relaxed text-text-main/80">
                      {!mainText && !hasNotes ? (
                        <div className="flex items-center gap-1.5 text-text-main/50 italic py-0.5">
                          <AlertCircle size={12} className="text-text-main/40" />
                          Нет описания для этого дня
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {mainText ? (
                            <span className="text-text-main/80">{mainText}</span>
                          ) : item.notes.length === 1 ? (
                            <span className="text-text-main/80">{item.notes[0]?.summary || item.notes[0]?.noteTitle}</span>
                          ) : (
                            <ul className="space-y-1.5 text-text-main/80">
                              {item.notes.map((n, i) => (
                                <li key={n.documentId || i} className="flex items-start gap-2">
                                  <span className="text-brand-soft select-none font-bold">•</span>
                                  <span>{n.summary || n.noteTitle}</span>
                                </li>
                              ))}
                            </ul>
                          )}

                          {isExpanded && hasDetails && (
                            <div className="mt-2.5 pt-2.5 border-t border-border-subtle/30 space-y-3">
                              {hasFacts && (
                                <div className="space-y-1">
                                  <div className="text-[10px] font-mono uppercase tracking-wider text-text-main/50 font-bold">Факты:</div>
                                  <ul className="list-disc pl-4 space-y-1 text-text-main/70">
                                    {item.facts.map((fact, idx) => (
                                      <li key={idx}>{fact}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {hasInsights && (
                                <div className="space-y-1">
                                  <div className="text-[10px] font-mono uppercase tracking-wider text-text-main/50 font-bold">Инсайты:</div>
                                  <ul className="list-disc pl-4 space-y-1 text-text-main/70">
                                    {item.insights.map((insight, idx) => (
                                      <li key={idx}>{insight}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
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
