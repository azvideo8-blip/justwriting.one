import { Pencil, X } from 'lucide-react';
import { cn } from '../../../core/utils/utils';

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
    <div className="flex items-center gap-2 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
      <span className="font-mono text-[10px] text-text-main/25 uppercase tracking-widest mr-1">
        {t('archive_tags_label')}
      </span>
      {allTags.map(tag => {
        const active = selectedTags.includes(tag);
        if (renamingTag === tag) {
          return (
            <div key={tag} className="flex items-center gap-1 px-2 py-1 rounded-xl border border-border-subtle bg-surface-card">
              <span className="text-[11px] font-mono text-text-main/40">#</span>
              <input
                value={renameTagValue}
                onChange={e => setRenameTagValue(e.target.value)}
                autoFocus
                className="w-20 bg-transparent text-[12px] text-text-main outline-none"
                onKeyDown={async e => {
                  if (e.key === 'Enter') onRenameSubmit(tag, renameTagValue);
                  if (e.key === 'Escape') onRenameCancel();
                }}
              />
              <button onClick={onRenameCancel} className="text-[10px] text-text-main/30 hover:text-text-main/50">✕</button>
            </div>
          );
        }
        return (
          <div key={tag} className="group/tag relative flex items-center">
            <button
              onClick={() => onToggleTag(tag)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-mono transition-all border",
                active
                  ? "bg-text-main/10 border-text-main/30 text-text-main"
                  : "bg-transparent border-border-subtle text-text-main/40 hover:text-text-main/60"
              )}
            >
              #{tag}
            </button>
            {showControls && (
              <span className="absolute -top-1.5 -right-1.5 opacity-0 group-hover/tag:opacity-100 transition-opacity flex gap-0.5">
                <button
                  onClick={e => { e.stopPropagation(); onStartRename(tag); }}
                  className="w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-text-main/60"
                >
                  <Pencil size={7} />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onDeleteTag(tag); }}
                  className="w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-red-400"
                >
                  <X size={7} />
                </button>
              </span>
            )}
          </div>
        );
      })}
      {selectedTags.length > 0 && (
        <button
          onClick={onResetTags}
          className="px-2.5 py-1 rounded-full text-[11px] font-mono border border-dashed border-border-subtle text-text-main/30 hover:text-text-main/50 transition-all"
        >
          {t('archive_tags_reset')} ✕
        </button>
      )}
    </div>
  );
}
