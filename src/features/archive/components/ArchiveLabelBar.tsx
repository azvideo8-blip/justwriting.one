import { Pencil, X } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { Label } from '../../../types';
import { LABEL_PRESET_COLORS } from '../../../core/constants/labelColors';

interface ArchiveLabelBarProps {
  labels: Label[];
  selectedLabels: string[];
  onToggleLabel: (id: string) => void;
  addingLabel: boolean;
  setAddingLabel: (v: boolean) => void;
  newLabelName: string;
  setNewLabelName: (v: string) => void;
  newLabelColor: string;
  setNewLabelColor: (v: string) => void;
  onAddLabel: () => void;
  editingLabelId: string | null;
  setEditingLabelId: (id: string | null) => void;
  editLabelName: string;
  setEditLabelName: (v: string) => void;
  editLabelColor: string;
  setEditLabelColor: (v: string) => void;
  onUpdateLabel: (id: string) => void;
  onDeleteLabel: (id: string) => void;
  showControls: boolean;
  t: (key: string) => string;
}

export function ArchiveLabelBar({
  labels, selectedLabels, onToggleLabel,
  addingLabel, setAddingLabel,
  newLabelName, setNewLabelName,
  newLabelColor, setNewLabelColor, onAddLabel,
  editingLabelId, setEditingLabelId,
  editLabelName, setEditLabelName,
  editLabelColor: _editLabelColor, setEditLabelColor,
  onUpdateLabel, onDeleteLabel,
  showControls, t,
}: ArchiveLabelBarProps) {
  if (labels.length === 0 && !showControls) return null;

  return (
    <div className="flex items-center gap-2 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
      <span className="font-mono text-[9px] text-text-main/25 uppercase tracking-widest mr-1">
        {t('archive_labels')}
      </span>
      {labels.map(label => {
        const active = selectedLabels.includes(label.id);
        if (editingLabelId === label.id) {
          return (
            <div key={label.id} className="flex items-center gap-2 px-2 py-1 rounded-xl border border-border-subtle bg-surface-card">
              <input
                value={editLabelName}
                onChange={e => setEditLabelName(e.target.value)}
                autoFocus
                className="w-24 bg-transparent text-[12px] text-text-main outline-none"
                onKeyDown={e => {
                  if (e.key === 'Enter') onUpdateLabel(label.id);
                  if (e.key === 'Escape') setEditingLabelId(null);
                }}
              />
              <div className="flex gap-1.5 md:gap-1">
                {LABEL_PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    style={{ background: c }}
                    className={cn("w-6 h-6 md:w-4 md:h-4 rounded-full transition-colors cursor-pointer")}
                    onClick={() => setEditLabelColor(c)}
                  />
                ))}
              </div>
              <button onClick={() => onUpdateLabel(label.id)}
                disabled={!editLabelName.trim()}
                className="text-label font-medium text-text-main/60 hover:text-text-main disabled:opacity-30">
                {t('common_save')}
              </button>
              <button onClick={() => setEditingLabelId(null)} className="text-label text-text-main/30 hover:text-text-main/50">✕</button>
            </div>
          );
        }
        return (
          <div key={label.id} className="group/label relative flex items-center">
            <button
              onClick={() => onToggleLabel(label.id)}
              className={cn(
                 "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono transition-colors border",
                active ? "border-transparent text-white" : "bg-transparent border-border-subtle text-text-main/50 hover:text-text-main/70"
              )}
              style={active ? { background: label.color, borderColor: label.color, boxShadow: `0 0 12px color-mix(in srgb, ${label.color} 45%, transparent)` } : {}}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: label.color }} />
              {label.name}
            </button>
            {showControls && (
              <span className="hidden md:flex absolute -top-1.5 -right-1.5 opacity-0 group-hover/label:opacity-100 transition-opacity gap-0.5">
                <button
                  onClick={e => { e.stopPropagation(); setEditingLabelId(label.id); setEditLabelName(label.name); setEditLabelColor(label.color); }}
                  className="w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/50 hover:text-text-main"
                  title="Rename"
                >
                  <Pencil className="w-1.5 h-1.5" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onDeleteLabel(label.id); }}
                  className="w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/50 hover:text-red-400"
                  title="Delete"
                >
                  <X className="w-1.5 h-1.5" />
                </button>
              </span>
            )}
          </div>
        );
      })}
      {selectedLabels.length > 0 && (
        <button
          onClick={() => selectedLabels.forEach(id => onToggleLabel(id))}
           className="px-2 py-0.5 rounded-full text-[10px] font-mono border border-dashed border-border-subtle text-text-main/30 hover:text-text-main/50 transition-colors"
        >
          {t('archive_tags_reset')} ✕
        </button>
      )}
      {showControls && !addingLabel && !editingLabelId && (
        <button
          onClick={() => setAddingLabel(true)}
           className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono text-text-main/30 hover:text-text-main/50 border border-dashed border-border-subtle transition-colors"
        >
          + {t('archive_add_label')}
        </button>
      )}
      {showControls && addingLabel && (
        <div className="flex items-center gap-2 px-2 py-1 rounded-xl border border-border-subtle bg-surface-card">
          <input
            value={newLabelName}
            onChange={e => setNewLabelName(e.target.value)}
            placeholder={t('archive_label_name_placeholder')}
            autoFocus
            className="w-28 bg-transparent text-[12px] text-text-main outline-none placeholder:text-text-main/25"
            onKeyDown={e => {
              if (e.key === 'Enter') onAddLabel();
              if (e.key === 'Escape') { setAddingLabel(false); setNewLabelName(''); }
            }}
          />
          <div className="flex gap-1">
            {LABEL_PRESET_COLORS.map(c => (
              <button
                key={c}
                style={{ background: c }}
                className={cn("w-4 h-4 rounded-full transition-colors", newLabelColor === c && "ring-2 ring-offset-1 ring-offset-surface-card ring-white/40")}
                onClick={() => setNewLabelColor(c)}
              />
            ))}
            <div className="relative">
              <input type="color" defaultValue={newLabelColor} onChange={e => setNewLabelColor(e.target.value)} className="sr-only" id="new-label-color" />
              <label htmlFor="new-label-color"
                className={cn("w-4 h-4 rounded-full border border-dashed border-border-subtle flex items-center justify-center cursor-pointer text-[9px] text-text-main/40 hover:border-text-main/40",
                  !LABEL_PRESET_COLORS.includes(newLabelColor) && "ring-2 ring-offset-1 ring-offset-surface-card"
                )}
                style={!LABEL_PRESET_COLORS.includes(newLabelColor) ? { background: newLabelColor } : {}}
              >
                {LABEL_PRESET_COLORS.includes(newLabelColor) && '+'}
              </label>
            </div>
          </div>
          <button
            onClick={onAddLabel}
            disabled={!newLabelName.trim()}
            className="text-label-sm font-medium text-text-main/60 hover:text-text-main disabled:opacity-30 transition-colors"
          >
            {t('common_save')}
          </button>
          <button onClick={() => { setAddingLabel(false); setNewLabelName(''); }}
            className="text-label-sm text-text-main/30 hover:text-text-main/50 transition-colors">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
