import { useState, useRef, useEffect, type MouseEvent as ReactMouseEvent } from 'react';
import { Plus, FileText, RotateCcw, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { DialogueLists } from '../../hooks/useDialogueManager';
import { mapLoadState, type LoadState } from '../../../../shared/loadState';
import { DialogueRows } from './DialogueRows';
import { Button } from '../../../../shared/components/Button';
import { useLanguage } from '../../../../shared/i18n';
import { cn } from '../../../../core/utils/utils';
import { Monogram, threadPreview } from '../AIChatPresentational';
import { personaVisual } from '../../constants/personaVisuals';

export interface AIChatSidebarProps {
  list: LoadState<DialogueLists>;
  activeDialogueId: string | null;
  onSelectDialogue: (id: string, personaId: string) => void;
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
  onNewDialogue: () => void;
  onUnarchive: (id: string) => void;
}

export function AIChatSidebar(props: AIChatSidebarProps) {
  const {
    list,
    activeDialogueId,
    onSelectDialogue,
    showArchived,
    setShowArchived,
    onNewDialogue,
    onUnarchive,
  } = props;
  const { t } = useLanguage();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('justwriting_sidebar_collapsed') === 'true');
  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('justwriting_sidebar_collapsed', String(next));
  };

  // AX-4: Resizable sidebar — persisted to localStorage
  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 480;
  const SIDEBAR_KEY = 'ai_sidebar_width';
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    const w = saved ? parseInt(saved, 10) : 286;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarDragRef = useRef(false);

  useEffect(() => { sidebarWidthRef.current = sidebarWidth; }, [sidebarWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!sidebarDragRef.current) return;
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX));
      setSidebarWidth(w);
    };
    const onMouseUp = () => {
      if (sidebarDragRef.current) {
        sidebarDragRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(SIDEBAR_KEY, String(sidebarWidthRef.current));
      }
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startSidebarDrag = (e: ReactMouseEvent) => {
    e.preventDefault();
    sidebarDragRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <>
      <div
        className="border-r border-border-subtle flex flex-col bg-surface-card/30 transition-[width] duration-200"
        style={{ width: sidebarCollapsed ? '60px' : sidebarWidth, flexShrink: 0 }}
      >
        {sidebarCollapsed ? (
          <div className="p-2 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={toggleSidebar}
              className="w-10 h-10 flex items-center justify-center rounded-xl text-text-main/60 hover:text-text-main hover:bg-surface-elevated transition-colors border border-border-subtle/50"
              title={t('ai_sidebar_expand')}
            >
              <PanelLeftOpen size={16} />
            </button>
            <button
              type="button"
              onClick={onNewDialogue}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-brand-soft/10 text-brand-soft border border-brand-soft/20 hover:bg-brand-soft/20 transition-colors"
              title={t('ai_new_dialogue')}
            >
              <Plus size={16} />
            </button>
          </div>
        ) : (
          <>
            <div className="p-4 pb-3.5 flex items-center gap-2">
              <Button
                onClick={onNewDialogue}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-soft/10 border border-brand-soft/25 text-brand-soft text-sm font-semibold hover:bg-brand-soft/20 transition-colors"
              >
                <Plus size={15} />
                {t('ai_new_dialogue')}
              </Button>
              <button
                type="button"
                onClick={toggleSidebar}
                className="p-2.5 rounded-xl text-text-main/60 hover:text-text-main hover:bg-surface-elevated transition-colors border border-border-subtle"
                title={t('ai_sidebar_collapse')}
              >
                <PanelLeftClose size={15} />
              </button>
            </div>

            <div className="flex gap-1 px-4 pb-3.5">
              <Button
                onClick={() => setShowArchived(false)}
                className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", !showArchived ? "bg-surface-elevated text-text-main" : "text-text-main/60 hover:text-text-main")}
              >
                {t('ai_active')}
              </Button>
              <Button
                onClick={() => setShowArchived(true)}
                className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", showArchived ? "bg-surface-elevated text-text-main" : "text-text-main/60 hover:text-text-main")}
              >
                {t('ai_archive')}
              </Button>
            </div>

            <div className="h-px bg-border-subtle mx-4 mb-1.5" />

            <div className="flex-1 overflow-y-auto px-3 py-1.5 space-y-0.5">

              <DialogueRows
                state={mapLoadState(list, l => (showArchived ? l.archived : l.active), rows => rows.length === 0)}
                showArchived={showArchived}
                noticeClassName="mx-2 my-2 px-3 py-2 rounded-xl text-xs gap-2"
              >
              {rows => rows.map(d => {
                const v = personaVisual(d.personaId, d.personaName);
                const isActive = activeDialogueId === d.id;
                const preview = threadPreview(d);
                return (
                  <Button
                    key={d.id}
                    onClick={() => onSelectDialogue(d.id, d.personaId)}
                    className="w-full text-left relative flex gap-3 px-3 py-3 rounded-xl transition-colors"
                    style={isActive ? { background: `linear-gradient(90deg, ${v.color}16, transparent 75%)` } : undefined}
                  >
                    {isActive && (
                      <span
                        className="absolute left-1 top-3.5 bottom-3.5 w-[2.5px] rounded-full"
                        style={{ background: v.color, boxShadow: `0 0 9px ${v.color}90` }}
                      />
                    )}
                    <Monogram color={v.color} mono={v.mono} size={28} dim={!isActive} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={cn("flex-1 min-w-0 text-sm font-medium truncate", isActive ? "text-text-main" : "text-text-main/55")}>{d.title}</span>
                        <span className="text-[9.5px] font-mono text-text-main/60 shrink-0">{new Date(d.updatedAt).toLocaleDateString()}</span>
                      </span>
                      <span className={cn("flex items-center gap-1.5 mt-1 text-xs leading-snug truncate", isActive ? "text-text-main/60" : "text-text-main/60")}>
                        {d.documentId && <FileText size={10} className="shrink-0" />}
                        <span className="truncate">{preview}</span>
                      </span>
                    </span>
                    {showArchived && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onUnarchive(d.id); }}
                        className="shrink-0 p-1.5 rounded-lg text-text-main/60 hover:text-brand-soft transition-colors"
                        title={t('ai_unarchive')}
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </Button>
                );
              })}
              </DialogueRows>
            </div>
          </>
        )}
      </div>
      {!sidebarCollapsed && (
        <div
          onMouseDown={startSidebarDrag}
          className="w-1 cursor-col-resize hover:bg-brand-soft/30 transition-colors shrink-0"
          style={{ marginRight: -1 }}
        />
      )}
    </>
  );
}
