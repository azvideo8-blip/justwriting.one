import { Pencil, X } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';

interface ArchiveTagBarProps {
  allTags: string[];
  selectedTags: string[];
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
  t: (key: string) => string;
}

export function ArchiveTagBar({
  allTags, selectedTags, onToggleTag,
  renamingTag, renameTagValue, setRenameTagValue,
  onStartRename, onRenameSubmit, onRenameCancel, onDeleteTag,
  onResetTags, showControls, t,
}: ArchiveTagBarProps) {
  if (allTags.length === 0) return null;

  return (
    <div className="flex items-center gap-2 py-3 flex-wrap border-b border-border-subtle" >
      <span className="font-mono text-[9px] text-text-main/25 uppercase tracking-widest mr-1">
        {t('archive_tags_label')}
      </span>
      {allTags.map(tag => {
        const active = selectedTags.includes(tag);
        if (renamingTag === tag) {
          return (
            <div key={tag} className="flex items-center gap-1 px-2 py-1 rounded-xl border border-border-subtle bg-surface-card">
               <span className="text-[9px] font-mono text-text-main/40">#</span>
               <input
                 value={renameTagValue}
                 onChange={e => setRenameTagValue(e.target.value)}
                 autoFocus
                 className="w-20 bg-transparent text-[12px] text-text-main outline-none"
                 onKeyDown={e => {
                   if (e.key === 'Enter') void onRenameSubmit(tag, renameTagValue);
                   if (e.key === 'Escape') onRenameCancel();
                 }}
               />
              <Button onClick={onRenameCancel} className="text-label text-text-main/30 hover:text-text-main/50">✕</Button>
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
                 "px-2 py-0.5 rounded-full text-[10px] font-mono transition-colors border",
                active
                  ? "bg-brand-soft/15 border-brand-soft/40 text-brand-soft"
                  : "bg-transparent border-border-subtle text-text-main/40 hover:text-text-main/60"
              )}
            >
              #{tag}
            </motion.button>
            {showControls && (
              <span className="hidden md:flex absolute -top-1.5 -right-1.5 opacity-0 group-hover/tag:opacity-100 transition-opacity gap-0.5">
                <IconButton
                  onClick={e => { e.stopPropagation(); onStartRename(tag); }}
                  className="w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/50 hover:text-text-main"
                  label="Rename"
                  icon={<Pencil className="w-1.5 h-1.5" />}
                />
                <IconButton
                  onClick={e => { e.stopPropagation(); onDeleteTag(tag); }}
                  className="w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/50 hover:text-accent-danger"
                  label="Delete"
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
           className="px-2 py-0.5 rounded-full text-[10px] font-mono border border-dashed border-border-subtle text-text-main/30 hover:text-text-main/50 transition-colors"
        >
          {t('archive_tags_reset')} ✕
        </Button>
      )}
    </div>
  );
}
