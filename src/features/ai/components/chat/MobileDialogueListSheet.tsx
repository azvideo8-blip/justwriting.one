import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Pencil, RotateCcw, Trash2, FileText } from 'lucide-react';
import type { AIDialogue } from '../../../../core/storage/localDb';
import { ModalShell, SECTION_LABEL, SheetTitle } from '../../../../shared/components/ModalShell';
import { useLanguage } from '../../../../shared/i18n';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { IconButton } from '../../../../shared/components/IconButton';
import { cn } from '../../../../core/utils/utils';
import { personaVisual } from '../../constants/personaVisuals';
import { relativeDate } from '../../../../core/utils/dateUtils';
import { hasOnlyTouchPointer } from '../../../../shared/utils/touchPointer';

export interface MobileDialogueListSheetProps {
  open: boolean;
  onClose: () => void;
  dialogues: AIDialogue[];
  archivedDialogues: AIDialogue[];
  activeDialogueId: string | null;
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
  onSelectDialogue: (id: string, personaId: string) => void;
  onRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDelete: (id: string) => void;
}

const HOLD_MS = 500;

/** Календарных дней от даты до сегодня — группы «Сегодня / На этой неделе / Раньше». */
function daysAgo(ts: number): number {
  const now = new Date();
  const then = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const thatDay = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  return Math.round((today - thatDay) / 86_400_000);
}

export function MobileDialogueListSheet(props: MobileDialogueListSheetProps) {
  const {
    open, onClose, dialogues, archivedDialogues, activeDialogueId,
    showArchived, setShowArchived, onSelectDialogue,
    onRename, onArchive, onUnarchive, onDelete,
  } = props;
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [actionsFor, setActionsFor] = useState<AIDialogue | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const holdTimer = useRef<number | null>(null);

  // Лист закрывается по «назад» сам: ModalShell уже подписан на usePanelHistory.
  // Сброс состояния — в закрытии, а не в эффекте на [open]: эффект с setState
  // даёт каскадный рендер (react-hooks/set-state-in-effect).
  const closeList = () => {
    setActionsFor(null);
    setQuery('');
    setRenaming(false);
    onClose();
  };

  const source = showArchived ? archivedDialogues : dialogues;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q ? source : source.filter(d =>
      d.title.toLowerCase().includes(q) || (d.messages[0]?.content ?? '').toLowerCase().includes(q));
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [source, query]);

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: AIDialogue[] }[] = [];
    for (const d of rows) {
      const days = daysAgo(d.updatedAt);
      const key = days <= 0 ? 'today' : days < 7 ? 'week' : 'earlier';
      const label = key === 'today' ? t('ai_dialogues_today') : key === 'week' ? t('ai_dialogues_this_week') : t('ai_dialogues_earlier');
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(d);
      else out.push({ key, label, items: [d] });
    }
    return out;
  }, [rows, t]);

  const openActions = (d: AIDialogue) => { setActionsFor(d); setRenaming(false); };

  const pick = (d: AIDialogue) => {
    onSelectDialogue(d.id, d.personaId);
    closeList();
  };

  // Как у NoteRow: после удержания отпускание пальца даёт click — без флага он
  // выбирал диалог и закрывал оба листа поверх только что открытых действий
  // (ревью 0.9.39).
  const holdFired = useRef(false);
  const startHold = (d: AIDialogue) => {
    holdFired.current = false;
    holdTimer.current = window.setTimeout(() => { holdFired.current = true; openActions(d); }, HOLD_MS);
  };
  const cancelHold = () => {
    if (holdTimer.current !== null) { window.clearTimeout(holdTimer.current); holdTimer.current = null; }
  };
  useEffect(() => cancelHold, []);

  const listTitleId = 'mobile-dialogues-title';
  const actionsTitleId = 'mobile-dialogue-actions-title';

  return (
    <>
      <ModalShell open={open} onClose={closeList} labelId={listTitleId} variant="sheet">
        {/* flex-1 + min-h-0: панель ModalShell ограничена 85vh и обрезает содержимое. */}
        <div className="flex flex-col min-h-0 flex-1">
          <div className="px-4 pt-4 pb-2">
            <SheetTitle id={listTitleId}>{t('ai_dialogues_open')}</SheetTitle>
          </div>
          <div className="px-4 pb-2">
            <Input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('ai_dialogues_search_placeholder')}
              aria-label={t('ai_dialogues_search_placeholder')}
              // SA-11: на телефоне фокус в поиске поднимал клавиатуру поверх списка.
              data-no-initial-focus={hasOnlyTouchPointer() ? '' : undefined}
              className="bg-surface-base min-h-11 text-[16px]"
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
            {groups.map(g => (
              <div key={g.key}>
                <div className={`px-3 pt-3 pb-1 ${SECTION_LABEL}`}>{g.label}</div>
                {g.items.map(d => {
                  const v = personaVisual(d.personaId, d.personaName);
                  const isActive = activeDialogueId === d.id;
                  return (
                    <Button
                      key={d.id}
                      data-testid="dialogue-row"
                      onClick={() => { if (holdFired.current) { holdFired.current = false; return; } pick(d); }}
                      onContextMenu={e => { e.preventDefault(); openActions(d); }}
                      onTouchStart={() => startHold(d)}
                      onTouchEnd={cancelHold}
                      onTouchMove={cancelHold}
                      className="w-full text-left flex items-start gap-3 px-3 py-3 rounded-xl transition-colors active:bg-surface-elevated"
                      style={isActive ? { background: `linear-gradient(90deg, ${v.color}16, transparent 75%)` } : undefined}
                    >
                      {/* SA-11: цвет персоны — только у открытого диалога, смысл подписан в строке ниже. */}
                      {isActive && <span className="mt-1.5 w-[9px] h-[9px] rounded-full shrink-0" style={{ background: v.color }} />}
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-sm font-medium truncate', isActive ? 'text-text-main' : 'text-text-main/70')}>{d.title}</span>
                        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-text-main/55 truncate">
                          {d.documentId && <FileText size={11} className="shrink-0" />}
                          {d.personaName} · {relativeDate(d.updatedAt)}
                          {d.documentId ? ` · ${t('ai_dialogue_note_ref')}` : ''}
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            ))}
            {rows.length === 0 && (
              <div className="py-8 text-center text-xs text-text-main/60">{t('ai_no_active_dialogues')}</div>
            )}
            {/* SA-11: «ноль — не показатель»: пустой архив строки не получает, ноль не пишем. */}
            {(showArchived || archivedDialogues.length > 0) && (
              <Button
                onClick={() => setShowArchived(!showArchived)}
                className="w-full mt-2 px-3 py-3 rounded-xl text-sm font-medium text-text-main/75 border border-border-subtle flex items-center justify-between"
              >
                <span>
                  {showArchived ? t('ai_dialogues_active_row') : t('ai_dialogues_archived_row')}
                  {(showArchived ? dialogues.length : archivedDialogues.length) > 0
                    ? ` · ${showArchived ? dialogues.length : archivedDialogues.length}`
                    : ''}
                </span>
                {showArchived ? <RotateCcw size={15} /> : <Archive size={15} />}
              </Button>
            )}
          </div>
        </div>
      </ModalShell>

      <ModalShell open={!!actionsFor} onClose={() => setActionsFor(null)} labelId={actionsTitleId} variant="sheet">
        {actionsFor && (
          <div className="p-4 space-y-2">
            <SheetTitle id={actionsTitleId} className="truncate">{actionsFor.title}</SheetTitle>
            {renaming ? (
              <div className="space-y-2">
                <Input
                  autoFocus
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  aria-label={t('ai_dialogue_rename')}
                  className="bg-surface-base min-h-11 text-[16px]"
                />
                {/* U-6 (решение владельца 2026-10-18): primary-инверсия вместо bg-accent + text-white. */}
                <Button
                  variant="primary"
                  onClick={() => { const v = renameValue.trim(); if (v) { onRename(actionsFor.id, v); setActionsFor(null); } }}
                  className="w-full py-3 rounded-xl text-sm font-semibold"
                >
                  {t('ai_dialogue_rename')}
                </Button>
              </div>
            ) : (
              <>
                <IconButton
                  onClick={() => { setRenaming(true); setRenameValue(actionsFor.title); }}
                  label={t('ai_dialogue_rename')} title={t('ai_dialogue_rename')} icon={<Pencil size={16} />}
                  className="w-full h-11 justify-start gap-3 px-3 rounded-xl border border-border-subtle text-text-main"
                />
                {showArchived ? (
                  <IconButton
                    onClick={() => { onUnarchive(actionsFor.id); setActionsFor(null); }}
                    label={t('ai_unarchive')} title={t('ai_unarchive')} icon={<RotateCcw size={16} />}
                    className="w-full h-11 justify-start gap-3 px-3 rounded-xl border border-border-subtle text-text-main"
                  />
                ) : (
                  <IconButton
                    onClick={() => { onArchive(actionsFor.id); setActionsFor(null); }}
                    label={t('ai_to_archive')} title={t('ai_to_archive')} icon={<Archive size={16} />}
                    className="w-full h-11 justify-start gap-3 px-3 rounded-xl border border-border-subtle text-text-main"
                  />
                )}
                <IconButton
                  onClick={() => { onDelete(actionsFor.id); setActionsFor(null); }}
                  label={t('ai_delete')} title={t('ai_delete')} icon={<Trash2 size={16} />}
                  className="w-full h-11 justify-start gap-3 px-3 rounded-xl border border-border-subtle text-accent-danger"
                />
              </>
            )}
          </div>
        )}
      </ModalShell>
    </>
  );
}
