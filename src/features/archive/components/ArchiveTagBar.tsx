import { Pencil, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { SECTION_LABEL } from '../../../shared/components/ModalShell';

interface ArchiveTagBarProps {
  allTags: string[];
  selectedTags: string[];
  tagCounts?: Record<string, number>;
  onToggleTag: (tag: string) => void;
  renamingTag: string | null;
  renameTagValue: string;
  setRenameTagValue: (v: string) => void;
  onStartRename: (tag: string) => void;
  onRenameSubmit: (tag: string, newName: string) => void;
  onRenameCancel: () => void;
  onDeleteTag: (tag: string) => void;
  onResetTags: () => void;
  showControls: boolean;
  t?: (key: string) => string;
  /** MF-8: на телефоне у меток своя строка, поэтому подпись — просто «Теги». */
  labelKey?: string;
  /** MQ-7: «sheet» — панель на телефоне: подпись строчная, фишки Inter 14 и 44 px. */
  variant?: 'default' | 'sheet';
}

export function ArchiveTagBar({
  allTags, selectedTags, tagCounts, onToggleTag,
  renamingTag, renameTagValue, setRenameTagValue,
  onStartRename, onRenameSubmit, onRenameCancel, onDeleteTag,
  onResetTags, showControls, t: propT, labelKey = 'archive_tags_label', variant = 'default',
}: ArchiveTagBarProps) {
  const sheet = variant === 'sheet';
  const { t: hookT } = useLanguage();
  const t = propT ?? hookT;
  if (allTags.length === 0) return null;

  return (
    <div className="flex items-center gap-2 py-3 flex-wrap border-b border-border-subtle" >
      <span className={sheet ? cn(SECTION_LABEL, 'mr-1') : 'font-mono text-[9px] text-text-main/60 uppercase tracking-widest mr-1'}>
        {t(labelKey)}
      </span>
      {allTags.map(tag => {
        const active = selectedTags.includes(tag);
        if (renamingTag === tag) {
          return (
            <div key={tag} className="flex items-center gap-1 px-2 py-1 rounded-xl border border-border-subtle bg-surface-card">
               <span className="text-[9px] font-mono text-text-main/60">#</span>
               <input
                 value={renameTagValue}
                 onChange={e => setRenameTagValue(e.target.value)}
                 autoFocus
                 aria-label={t('archive_rename_tag_aria')}
                 className="w-20 bg-transparent text-[12px] text-text-main outline-none"
                 onKeyDown={e => {
                   if (e.key === 'Enter') void onRenameSubmit(tag, renameTagValue);
                   if (e.key === 'Escape') onRenameCancel();
                 }}
               />
              <Button onClick={onRenameCancel} className="text-label text-text-main/60 hover:text-text-main">✕</Button>
            </div>
          );
        }
        return (
          <div key={tag} className="group/tag relative flex items-center">
            <motion.button
              layout
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              onClick={() => onToggleTag(tag)}
              className={cn(
                sheet ? "min-h-11 gap-1.5 px-3 text-[14px] font-medium" : "px-2 py-0.5 text-[10px] font-mono gap-1",
                "rounded-full transition-colors border flex items-center",
                active
                  ? "bg-brand-soft/15 border-brand-soft/40 text-brand-soft"
                  : "bg-transparent border-border-subtle text-text-main/60 hover:text-text-main"
              )}
            >
              <span>#{tag}</span>
              <span className={cn(sheet ? "text-[12px]" : "font-mono text-[9px]", active ? "text-brand-soft/70" : "text-text-main/60")}>
                {tagCounts?.[tag] ?? 0}
              </span>
            </motion.button>
            {showControls && (
              // Две кнопки 16 px вплотную, только десктоп: запас 44 px (IconButton) выключен —
              // у «Удалить» он накрывал карандаш и половину самой фишки.
              <span className="hidden md:flex absolute -top-1.5 -right-1.5 opacity-0 group-hover/tag:opacity-100 transition-opacity gap-0.5">
                <IconButton
                  onClick={e => { e.stopPropagation(); onStartRename(tag); }}
                  className="after:hidden w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/60 hover:text-text-main"
                  label={t('archive_tag_rename')}
                  icon={<Pencil className="w-1.5 h-1.5" />}
                />
                <IconButton
                  onClick={e => { e.stopPropagation(); onDeleteTag(tag); }}
                  className="after:hidden w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/60 hover:text-accent-danger"
                  label={t('archive_tag_delete')}
                  icon={<X className="w-1.5 h-1.5" />}
                />
              </span>
            )}
          </div>
        );
      })}
      {selectedTags.length > 0 && (
        <Button
          onClick={onResetTags}
          className={cn(
            "rounded-full border border-dashed border-border-subtle text-text-main/60 hover:text-text-main transition-colors",
            sheet ? "min-h-11 px-3 text-[14px] font-medium" : "px-2 py-0.5 text-[10px] font-mono",
          )}
        >
          {t('archive_tags_reset')} ✕
        </Button>
      )}
    </div>
  );
}
