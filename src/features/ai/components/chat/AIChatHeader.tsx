import { useState, useRef, useEffect } from 'react';
import { Brain, Settings, Download, Pencil, Archive, Trash2, Plus, ChevronDown, Info, Menu, MoreHorizontal } from 'lucide-react';
import { IconButton } from '../../../../shared/components/IconButton';
import { Button } from '../../../../shared/components/Button';
import { ModalShell, SECTION_LABEL, SheetTitle } from '../../../../shared/components/ModalShell';
import { useLanguage } from '../../../../shared/i18n';
import { cn } from '../../../../core/utils/utils';
import { Monogram } from '../AIChatPresentational';
import { MobilePersonaSheet } from './MobilePersonaSheet';
import { personaVisual, type PersonaVisual } from '../../constants/personaVisuals';

export interface AIChatHeaderPersona {
  id: string;
  name: string;
  emoji: string;
  isPreset: boolean;
  systemPrompt?: string;
}

export interface AIChatHeaderProps {
  isMobile: boolean;
  headerVisual: PersonaVisual;
  activePersonaName: string;
  activeRole: string;
  dialogueTitle: string | undefined;
  hasActiveDialogue: boolean;
  activeDialogueId: string | null;
  onOpenMemory: () => void;
  responseLength: 'short' | 'standard' | 'detailed';
  reasoning: boolean;
  onSetResponseLength: (len: 'short' | 'standard' | 'detailed') => void;
  onToggleReasoning: (v: boolean) => void;
  onExport: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRename: (id: string, title: string) => void;
  selectedPersonaId: string;
  setSelectedPersonaId: (id: string) => void;
  allPersonas: AIChatHeaderPersona[];
  openPersonaDetail: (persona: AIChatHeaderPersona) => void;
  onCreatePersona: () => void;
  /** MR-1: ☰ открывает лист диалогов, «Новый диалог» заводит пустой. */
  onOpenDialogues: () => void;
  onNewDialogue: () => void;
  /** MP-4: остатки дневного лимита — одной строкой в листе «⋯», а не полосой
   *  под композером. */
  quota?: AIChatHeaderQuota | undefined;
}

export interface AIChatHeaderQuota {
  chatRemaining: number;
  chatTotal: number;
  reasoningRemaining: number;
  reasoningTotal: number;
}

export function AIChatHeader(props: AIChatHeaderProps) {
  const {
    isMobile,
    headerVisual,
    activePersonaName,
    activeRole,
    dialogueTitle,
    hasActiveDialogue,
    activeDialogueId,
    onOpenMemory,
    responseLength,
    reasoning,
    onSetResponseLength,
    onToggleReasoning,
    onExport,
    onArchive,
    onDelete,
    onRename,
    selectedPersonaId,
    setSelectedPersonaId,
    allPersonas,
    openPersonaDetail,
    onCreatePersona,
    onOpenDialogues,
    onNewDialogue,
    quota,
  } = props;
  const { t } = useLanguage();

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [volumeSettingsOpen, setVolumeSettingsOpen] = useState(false);
  const volumeSettingsRef = useRef<HTMLDivElement>(null);
  const [personaDropdownOpen, setPersonaDropdownOpen] = useState(false);
  const personaDropdownRef = useRef<HTMLDivElement>(null);
  // MR-1: на телефоне все действия диалога живут в одном «⋯».
  const [moreOpen, setMoreOpen] = useState(false);
  const [personaSheetOpen, setPersonaSheetOpen] = useState(false);
  const [mobileRename, setMobileRename] = useState(false);
  const [mobileRenameValue, setMobileRenameValue] = useState('');

  useEffect(() => {
    if (!volumeSettingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (volumeSettingsRef.current && !volumeSettingsRef.current.contains(e.target as Node)) {
        setVolumeSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [volumeSettingsOpen]);

  useEffect(() => {
    if (!personaDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (personaDropdownRef.current && !personaDropdownRef.current.contains(e.target as Node)) {
        setPersonaDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [personaDropdownOpen]);


  const handleSaveRename = () => {
    setIsRenaming(false);
    if (renameValue.trim() && activeDialogueId && renameValue.trim() !== dialogueTitle) {
      onRename(activeDialogueId, renameValue.trim());
    }
  };

  const volumeOptions: ('short' | 'standard' | 'detailed')[] = ['short', 'standard', 'detailed'];
  const volumeLabel = (len: 'short' | 'standard' | 'detailed') =>
    len === 'short' ? t('ai_volume_short') : len === 'standard' ? t('ai_volume_standard') : t('ai_volume_detailed');

  if (isMobile) {
    return (
      <div className="relative z-10 px-3 pt-3 pb-2 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <IconButton
            onClick={onOpenDialogues}
            className="w-11 h-11 shrink-0"
            title={t('ai_dialogues_open')}
            label={t('ai_dialogues_open')}
            icon={<Menu size={16} />}
          />
          <div className="flex-1 min-w-0 flex justify-center">
            {/* MR-1: имя персоны 22 px → токен по центру; MR-3 делает из него выбор
                персон, MR-11 поднял его до 44 px — меньше цели касания не остаётся. */}
            <button
              type="button"
              onClick={() => setPersonaSheetOpen(true)}
              className="press flex items-center gap-2 min-h-11 max-w-full px-3 rounded-full text-sm font-semibold text-text-main truncate"
              style={{ background: `${headerVisual.color}14`, borderColor: `${headerVisual.color}55`, borderWidth: 1 }}
            >
              <Monogram color={headerVisual.color} mono={headerVisual.mono} size={18} />
              {/* MP-3: роль в токене не участвует — на 375–390 px она не
                  сжималась («shrink-0») и резала имя до «Г…». Роль остаётся
                  второй строкой листа персон (MR-3). */}
              <span className="truncate">{activePersonaName}</span>
            </button>
          </div>
          {/* 0.10.1 (скрин владельца): «⋯» — в строке шапки, а не отдельной строкой
              под ней: на телефоне каждая строка — минус строка ответа. Есть и без
              открытого диалога: объём ответа и рассуждения выбирают до первого
              сообщения; действия диалога в листе — только при диалоге. */}
          <IconButton
            onClick={() => setMoreOpen(true)}
            className="w-11 h-11 shrink-0 rounded-xl text-text-main/60 flex items-center justify-center"
            title={t('ai_more')}
            label={t('ai_more')}
            icon={<MoreHorizontal size={16} />}
          />
          <IconButton
            onClick={onNewDialogue}
            className="w-11 h-11 shrink-0"
            title={t('ai_new_dialogue')}
            label={t('ai_new_dialogue')}
            icon={<Plus size={16} />}
          />
        </div>

        <MobilePersonaSheet
          open={personaSheetOpen}
          onClose={() => setPersonaSheetOpen(false)}
          personas={allPersonas}
          selectedPersonaId={selectedPersonaId}
          onSelect={setSelectedPersonaId}
          onDetail={openPersonaDetail}
          onCreate={onCreatePersona}
        />

        {/* MF-20: смонтирован всегда — open даёт листу уйти с анимацией. */}
          <ModalShell open={moreOpen} onClose={() => setMoreOpen(false)} labelId="ai-header-more-title" variant="sheet">
            <div className="p-4 space-y-2">
              <SheetTitle id="ai-header-more-title" className="truncate">{dialogueTitle ?? activePersonaName}</SheetTitle>
              <button
                type="button"
                onClick={() => { setMoreOpen(false); onOpenMemory(); }}
                className="w-full h-11 flex items-center gap-3 px-3 rounded-xl border border-border-subtle text-sm text-text-main"
              >
                <Brain size={16} /> {t('ai_memory_title')}
              </button>
              <div className="w-full rounded-xl border border-border-subtle p-3 space-y-2">
                <div className={SECTION_LABEL}>{t('ai_volume_response_heading')}</div>
                <div className="flex gap-1.5">
                  {volumeOptions.map(len => (
                    <button
                      key={len}
                      type="button"
                      onClick={() => onSetResponseLength(len)}
                      className={cn(
                        'flex-1 h-11 rounded-lg text-xs font-medium border transition-colors',
                        responseLength === len ? 'border-brand-soft/40 bg-brand-soft/15 text-brand-soft' : 'border-border-subtle text-text-main/60'
                      )}
                    >
                      {volumeLabel(len)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onToggleReasoning(!reasoning)}
                  className="w-full h-11 flex items-center justify-between px-3 rounded-lg text-xs font-medium border border-border-subtle text-text-main/70"
                >
                  <span>{t('ai_volume_reasoning')}</span>
                  <span className={cn('w-2 h-2 rounded-full', reasoning ? 'bg-brand-soft' : 'bg-text-main/20')} />
                </button>
              </div>
              {quota !== undefined && (
                <div className="w-full min-h-11 flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-border-subtle text-xs text-text-main/70">
                  <span>{t('ai_quota_today')}</span>
                  <span className="tabular-nums text-right">
                    {t('ai_quota_chat')} {quota.chatRemaining}/{quota.chatTotal}
                    {' · '}
                    {t('ai_quota_reasoning')} {quota.reasoningRemaining}/{quota.reasoningTotal}
                  </span>
                </div>
              )}
              {hasActiveDialogue && (<>
              {mobileRename ? (
                <div className="space-y-2">
                  <input
                    autoFocus
                    value={mobileRenameValue}
                    onChange={e => setMobileRenameValue(e.target.value)}
                    aria-label={t('ai_dialogue_rename')}
                    className="w-full h-11 rounded-xl border border-border-subtle bg-surface-base px-3 text-[16px] text-text-main"
                  />
                  {/* U-6 (решение владельца 2026-10-18): primary-инверсия вместо bg-accent + text-white. */}
                  <Button
                    variant="primary"
                    onClick={() => {
                      const v = mobileRenameValue.trim();
                      if (v && activeDialogueId) { onRename(activeDialogueId, v); setMoreOpen(false); }
                      setMobileRename(false);
                    }}
                    className="w-full h-11 rounded-xl text-sm font-semibold"
                  >
                    {t('ai_dialogue_rename')}
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setMobileRename(true); setMobileRenameValue(dialogueTitle ?? ''); }}
                  className="w-full h-11 flex items-center gap-3 px-3 rounded-xl border border-border-subtle text-sm text-text-main"
                >
                  <Pencil size={16} /> {t('ai_dialogue_rename')}
                </button>
              )}
              <button
                type="button"
                onClick={() => { setMoreOpen(false); onExport(); }}
                className="w-full h-11 flex items-center gap-3 px-3 rounded-xl border border-border-subtle text-sm text-text-main"
              >
                <Download size={16} /> {t('ai_download_md')}
              </button>
              <button
                type="button"
                onClick={() => { setMoreOpen(false); onArchive(); }}
                className="w-full h-11 flex items-center gap-3 px-3 rounded-xl border border-border-subtle text-sm text-text-main"
              >
                <Archive size={16} /> {t('ai_to_archive')}
              </button>
              <button
                type="button"
                onClick={() => { setMoreOpen(false); onDelete(); }}
                className="w-full h-11 flex items-center gap-3 px-3 rounded-xl border border-border-subtle text-sm text-accent-danger"
              >
                <Trash2 size={16} /> {t('ai_delete')}
              </button>
              </>)}
            </div>
          </ModalShell>

      </div>
    );
  }

  return (
    <div className="relative z-10 px-6 pt-5 pb-3.5 border-b border-border-subtle">
      <div className="flex items-center gap-3.5">
        <Monogram color={headerVisual.color} mono={headerVisual.mono} size={40} />
        <div className="min-w-0">
          <div className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-text-main/60 mb-1">{t('ai_interlocutor')}</div>
          <div className="flex items-baseline gap-2.5">
            {isRenaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={handleSaveRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveRename();
                  if (e.key === 'Escape') { setIsRenaming(false); }
                }}
                className="text-[22px] font-bold tracking-tight text-text-main bg-transparent border-b border-brand-soft/40 outline-none px-1 -mx-1 max-w-[300px]"
                placeholder={t('ai_dialogue_title_placeholder')}
                aria-label={t('ai_dialogue_title_placeholder')}
              />
            ) : (
              <h1 className="text-[22px] font-bold tracking-tight text-text-main truncate">{activePersonaName}</h1>
            )}
            {activeRole && !isRenaming && <span className="text-xs font-medium shrink-0" style={{ color: headerVisual.color }}>{activeRole}</span>}
          </div>
        </div>
        <div className="flex-1" />
        <IconButton onClick={onOpenMemory} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/45 hover:text-text-main transition-colors flex items-center justify-center" title={t('ai_memory_title')} label={t('ai_memory_title')} icon={<Brain size={15} />} />
        <div ref={volumeSettingsRef} className="relative">
          <IconButton
            onClick={() => setVolumeSettingsOpen(o => !o)}
            className={cn(
              "w-8 h-8 rounded-lg border flex items-center justify-center transition-colors",
              volumeSettingsOpen
                ? "border-brand-soft text-brand-soft bg-brand-soft/5"
                : "border-border-subtle text-text-main/45 hover:text-text-main"
            )}
            title={t('ai_volume_settings_title')}
            label={t('ai_volume_settings_title')}
            icon={<Settings size={15} />}
          />
          {volumeSettingsOpen && (
            <div className="absolute right-0 top-full mt-1.5 p-3 w-56 bg-surface-popup border border-border-subtle rounded-2xl shadow-xl z-30 space-y-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-text-main/60">{t('ai_volume_response_heading')}</div>
              <div className="flex flex-col gap-1.5">
                {volumeOptions.map(len => {
                  const active = responseLength === len;
                  return (
                    <button
                      key={len}
                      type="button"
                      onClick={() => onSetResponseLength(len)}
                      className={cn(
                        "w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                        active
                          ? "bg-brand-soft/15 border-brand-soft/30 text-brand-soft"
                          : "border-transparent text-text-main/60 hover:text-text-main hover:bg-text-main/[0.04]"
                      )}
                    >
                      {volumeLabel(len)}
                    </button>
                  );
                })}
              </div>
              <div className="h-px bg-border-subtle" />
              <button
                type="button"
                onClick={() => onToggleReasoning(!reasoning)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-xs font-medium border transition-colors flex items-center justify-between",
                  reasoning
                    ? "bg-brand-soft/15 border-brand-soft/30 text-brand-soft"
                    : "border-transparent text-text-main/60 hover:text-text-main hover:bg-text-main/[0.04]"
                )}
              >
                <span>{t('ai_volume_reasoning')}</span>
                <span className={cn("w-2 h-2 rounded-full", reasoning ? "bg-brand-soft" : "bg-text-main/20")} />
              </button>
            </div>
          )}
        </div>
        {hasActiveDialogue && (
          <div className="flex items-center gap-1">
             <IconButton onClick={onExport} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/45 hover:text-text-main transition-colors flex items-center justify-center" title={t('ai_download_md')} label={t('ai_download_md')} icon={<Download size={15} />} />
             <IconButton onClick={() => { setIsRenaming(true); setRenameValue(dialogueTitle ?? ''); }} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/45 hover:text-text-main transition-colors flex items-center justify-center" title={t('ai_dialogue_rename')} label={t('ai_dialogue_rename')} icon={<Pencil size={15} />} />
             <IconButton onClick={onArchive} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/45 hover:text-text-main transition-colors flex items-center justify-center" title={t('ai_to_archive')} label={t('ai_to_archive')} icon={<Archive size={15} />} />
             <IconButton onClick={onDelete} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/35 hover:text-accent-danger transition-colors flex items-center justify-center" title={t('ai_delete')} label={t('ai_delete')} icon={<Trash2 size={15} />} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-3.5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-main/55">{t('ai_interlocutor')}:</span>
        <div ref={personaDropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setPersonaDropdownOpen(o => !o)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border border-border-subtle bg-surface-base/5 hover:bg-surface-base/10 text-text-main transition-colors"
            style={{ borderColor: `${headerVisual.color}55`, background: `${headerVisual.color}14` }}
          >
            <Monogram color={headerVisual.color} mono={headerVisual.mono} size={16} />
            <span>{activePersonaName}</span>
            <ChevronDown size={12} className="opacity-60" />
          </button>
          {personaDropdownOpen && (
            <div className="absolute left-0 top-full mt-1.5 py-1.5 w-64 bg-surface-popup border border-border-subtle rounded-2xl shadow-xl z-30 max-h-80 overflow-y-auto">
              {allPersonas.map(p => {
                const v = personaVisual(p.id, p.name);
                const on = selectedPersonaId === p.id;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium transition-colors hover:bg-text-main/[0.04]",
                      on ? "text-text-main bg-brand-soft/5" : "text-text-main/60"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => { setSelectedPersonaId(p.id); setPersonaDropdownOpen(false); }}
                      className="flex-1 flex items-center gap-2.5 text-left py-0.5"
                    >
                      <Monogram color={v.color} mono={v.mono} size={18} />
                      <span className={cn(on && "font-semibold")}>{p.name}</span>
                    </button>
                    <IconButton
                      onClick={() => openPersonaDetail(p)}
                      className="w-5 h-5 rounded-full text-text-main/35 hover:text-text-main/70 hover:bg-text-main/10 flex items-center justify-center shrink-0 transition-colors"
                      title={t('ai_description_prompt')}
                      label={t('ai_description_prompt')}
                      icon={<Info size={13} />}
                    />
                  </div>
                );
              })}
              <div className="h-px bg-border-subtle my-1" />
              <button
                type="button"
                onClick={() => { onCreatePersona(); setPersonaDropdownOpen(false); }}
                className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-text-main/75 hover:bg-text-main/[0.04] transition-colors text-left"
              >
                <Plus size={14} />
                {t('ai_create')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
