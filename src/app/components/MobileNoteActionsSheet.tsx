import { useState } from 'react';
import { Tag, X } from 'lucide-react';
import { useLanguage } from '../../shared/i18n';
import { Label } from '../../types';
import { cn } from '../../core/utils/utils';
import { Button } from '../../shared/components/Button';
import { IconButton } from '../../shared/components/IconButton';
import { ModalShell } from '../../shared/components/ModalShell';
import { buildNoteActions } from '../../features/archive/components/noteActions';
import { useNoteStorageActions } from '../../features/archive/components/useNoteStorageActions';

interface MobileNoteActionsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  session: {
    id: string;
    title?: string | undefined;
    labelId?: string | undefined;
    excludedFromAI?: boolean | undefined;
    _isLocal?: boolean | undefined;
    _linkedCloudId?: string | undefined;
    _hasCloudCopy?: boolean | undefined;
    _hasPendingSync?: boolean | undefined;
    _isTooLargeForSync?: boolean | undefined;
    _localOnly?: boolean | undefined;
  };
  userId: string;
  labels?: Label[] | undefined;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onLabelChange: (labelId: string | undefined) => void;
  onStorageChange: () => void;
  /** Разбор заметки ИИ — тот же обработчик, что у кнопки ✨ в списке. */
  aiProcessed?: boolean | undefined;
  aiLoading?: boolean | undefined;
  onAIClick?: (() => void) | undefined;
  aiExclusionLoading?: boolean | undefined;
  onAIExclusionClick?: (() => void) | undefined;
}

/** Лист действий на телефоне. DC-A3: список строит та же функция
 *  `buildNoteActions`, что и меню «⋯» на десктопе, и те же обработчики —
 *  две поверхности больше не могут разойтись. */
export function MobileNoteActionsSheet({
  isOpen,
  onClose,
  session,
  userId,
  labels,
  onOpen,
  onRename,
  onDelete,
  onLabelChange,
  onStorageChange,
  aiProcessed,
  aiLoading,
  onAIClick,
  aiExclusionLoading,
  onAIExclusionClick,
}: MobileNoteActionsSheetProps) {
  const { t } = useLanguage();
  const [showLabelsSelector, setShowLabelsSelector] = useState(false);

  const doc = {
    localId: session._isLocal ? session.id : undefined,
    cloudId: session._linkedCloudId,
    hasLocal: !!session._isLocal,
    hasCloud: !!session._hasCloudCopy,
    hasPendingSync: !!session._hasPendingSync,
    isTooLargeForSync: !!session._isTooLargeForSync,
    localOnly: !!session._localOnly,
  };

  const storage = useNoteStorageActions({
    doc,
    userId,
    onStorageChange,
    ...(onAIExclusionClick
      ? { exclusion: { excluded: !!session.excludedFromAI, loading: !!aiExclusionLoading, onClick: onAIExclusionClick } }
      : {}),
  });

  const sections = buildNoteActions({
    t,
    doc,
    userId,
    storage,
    labels,
    currentLabelId: session.labelId,
    onLabelChange,
    onOpen: () => { onOpen(); onClose(); },
    onRename: () => { onRename(); onClose(); },
    ...(onAIClick
      ? { ai: { processed: !!aiProcessed, loading: !!aiLoading, onClick: onAIClick } }
      : {}),
    ...(onAIExclusionClick
      ? { exclusion: { excluded: !!session.excludedFromAI, loading: !!aiExclusionLoading, onClick: onAIExclusionClick } }
      : {}),
    onDelete: () => { onDelete(); onClose(); },
  });

  const labelsSection = sections.find(s => s.kind === 'labels');
  const selectedLabel = labels?.find(l => l.id === session.labelId);

  if (!isOpen) return null;

  return (
    <ModalShell open={isOpen} onClose={onClose} labelId="note-actions-sheet-title" variant="sheet">
        {/* Grab Handle */}
        <div className="flex justify-center py-3">
          <div className="w-12 h-1.5 rounded-full bg-white/10" />
        </div>

        {/* Header */}
        <div className="flex justify-between items-center px-6 pb-3">
          <h3 id="note-actions-sheet-title" className="sr-only">{t('archive_note_actions')}</h3>
          <span className="text-sm font-bold text-text-main/60 uppercase tracking-widest">
            {t('archive_note_actions')}
          </span>
          <IconButton
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/[0.04] border-none flex items-center justify-center text-text-main/60 hover:text-text-main/70 cursor-pointer"
            label={t('close')}
            icon={<X size={18} />}
          />
        </div>

        {/* Document Title Header */}
        <div className="px-6 py-4 bg-white/[0.01] border-y border-white/[0.04] flex items-center justify-between">
          <div className="min-w-0 flex-1 pr-4">
            <div className="text-base font-bold text-text-main truncate">
              {session.title || t('common_untitled')}
            </div>
            {selectedLabel && (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedLabel.color }} />
                <span className="text-xs text-text-main/60">{selectedLabel.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Options List */}
        <div className="px-6 py-5 overflow-y-auto no-scrollbar space-y-2 pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
          {!showLabelsSelector ? (
            sections.map(section => {
              if (section.kind === 'labels') return null;
              const Icon = section.icon;
              const isStorageAction = section.group === 'storage';
              return (
                <Button
                  key={section.id}
                  onClick={section.onSelect}
                  disabled={section.disabled}
                  className={cn(
                    'w-full min-h-[48px] flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-left font-medium transition-colors border',
                    section.destructive
                      ? 'text-accent-danger bg-accent-danger/10 border-accent-danger/20 active:bg-accent-danger/20'
                      : isStorageAction && (section.id === 'upload' || section.id === 'download')
                        ? 'text-brand-primary bg-brand-primary/10 border-brand-primary/20 active:bg-brand-primary/20 font-semibold'
                        : 'text-text-main/80 bg-white/[0.02] border-white/[0.04] active:bg-white/[0.06]',
                  )}
                >
                  <Icon size={18} className={section.destructive ? undefined : 'text-text-main/60'} aria-hidden="true" />
                  <span>{section.label}</span>
                </Button>
              );
            })
          ) : (
            // Labels Sub-selector
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-text-main/60 uppercase tracking-wider">{t('archive_assign_label')}</span>
                <Button onClick={() => setShowLabelsSelector(false)} className="text-xs text-brand-soft hover:underline">
                  {t('writing_back')}
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {labelsSection !== undefined && labelsSection.kind === 'labels' && labelsSection.options.map(option => (
                  <Button
                    key={option.key}
                    onClick={() => { option.onSelect(); onClose(); }}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-left transition-colors border',
                      option.checked
                        ? 'bg-text-main/10 border-text-main/20 text-text-main'
                        : 'bg-white/[0.01] border-white/[0.04] text-text-main/60 hover:bg-white/[0.03]',
                    )}
                  >
                    {option.dashed
                      ? <div className="w-3.5 h-3.5 rounded-full border border-dashed border-text-main/20 shrink-0" />
                      : <div className="w-3.5 h-3.5 rounded-full shrink-0" style={option.color ? { backgroundColor: option.color } : undefined} />}
                    <span className="flex-1">{option.label}</span>
                    {option.checked && <span className="text-xs text-brand-soft">✓</span>}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {labelsSection !== undefined && !showLabelsSelector && (
            <Button
              onClick={() => setShowLabelsSelector(true)}
              className="w-full min-h-[48px] flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium text-text-main/80 bg-white/[0.02] border border-white/[0.04] active:bg-white/[0.06] transition-colors text-left"
            >
              <Tag size={18} className="text-text-main/60" aria-hidden="true" />
              <span>{t('archive_assign_label')}</span>
            </Button>
          )}
        </div>

      {storage.dialogs}
    </ModalShell>
  );
}
