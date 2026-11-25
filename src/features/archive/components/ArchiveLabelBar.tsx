import { Pencil, X } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { Label } from '../../../types';
import { LABEL_PRESET_COLORS } from '../../../core/constants/labelColors';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { SECTION_LABEL } from '../../../shared/components/ModalShell';

interface ArchiveLabelBarProps {
  labels: Label[];
  selectedLabels: string[];
  labelCounts?: Record<string, number>;
  onToggleLabel: (id: string) => void;
  addingLabel: boolean;
  setAddingLabel: (v: boolean) => void;
  newLabelName: string;
  setNewLabelName: (v: string) => void;
  newLabelColor: string;
  setNewLabelColor: (v: string) => void;
  onAddLabel: () => void;
  /** Сохранение этой формы в пути: поля на месте, но не правятся. */
  savingNewLabel?: boolean;
  savingEditedLabel?: boolean;
  editingLabelId: string | null;
  setEditingLabelId: (id: string | null) => void;
  editLabelName: string;
  setEditLabelName: (v: string) => void;
  editLabelColor: string;
  setEditLabelColor: (v: string) => void;
  onUpdateLabel: (id: string) => void;
  onDeleteLabel: (id: string) => void;
  showControls: boolean;
  t?: (key: string, params?: Record<string, string | number>) => string;
  /** MQ-7: «sheet» — панель на телефоне: подпись строчная, фишки Inter 14 и 44 px. */
  variant?: 'default' | 'sheet';
}

export function ArchiveLabelBar({
  labels, selectedLabels, labelCounts, onToggleLabel,
  addingLabel, setAddingLabel,
  newLabelName, setNewLabelName,
  newLabelColor, setNewLabelColor, onAddLabel,
  editingLabelId, setEditingLabelId,
  editLabelName, setEditLabelName,
  editLabelColor, setEditLabelColor,
  onUpdateLabel, onDeleteLabel,
  savingNewLabel = false, savingEditedLabel = false,
  showControls, t: propT, variant = 'default',
}: ArchiveLabelBarProps) {
  const sheet = variant === 'sheet';
  const { t: hookT } = useLanguage();
  const t = propT ?? hookT;
  if (labels.length === 0 && !showControls) return null;

  return (
    <div className="flex items-center gap-2 py-3 flex-wrap border-b border-border-subtle" >
      <span className={sheet ? cn(SECTION_LABEL, 'mr-1') : 'font-mono text-[9px] text-text-main/60 uppercase tracking-widest mr-1'}>
        {t('archive_labels')}
      </span>
      {labels.map(label => {
        const active = selectedLabels.includes(label.id);
        if (editingLabelId === label.id) {
          return (
            <div key={label.id} className="flex items-center gap-2 px-2 py-1 rounded-xl border border-border-subtle bg-surface-card">
              <input
                value={editLabelName}
                readOnly={savingEditedLabel}
                onChange={e => setEditLabelName(e.target.value)}
                autoFocus
                aria-label={t('archive_label_name_aria')}
                className="w-24 bg-transparent text-[12px] text-text-main outline-none"
                onKeyDown={e => {
                  if (e.key === 'Enter') onUpdateLabel(label.id);
                  if (e.key === 'Escape') setEditingLabelId(null);
                }}
              />
              <div className="flex gap-1.5 md:gap-1">
                {LABEL_PRESET_COLORS.map(c => (
                <Button
                  key={c}
                  style={{ background: c }}
                  className={cn("w-6 h-6 md:w-4 md:h-4 rounded-full transition-colors cursor-pointer p-0 min-w-0", editLabelColor === c && "ring-2 ring-offset-1 ring-offset-surface-card ring-text-main/40")}
                  disabled={savingEditedLabel}
                  onClick={() => setEditLabelColor(c)}
                  aria-label={t('archive_label_color_aria', { color: c })}
                />
                ))}
              </div>
              <Button onClick={() => onUpdateLabel(label.id)}
                disabled={!editLabelName.trim() || savingEditedLabel}
                className="text-label font-medium text-text-main/60 hover:text-text-main disabled:opacity-30">
                {t('common_save')}
              </Button>
              <Button onClick={() => setEditingLabelId(null)} className="text-label text-text-main/60 hover:text-text-main">✕</Button>
            </div>
          );
        }
        return (
          <div key={label.id} className="group/label relative flex items-center">
            <Button
              onClick={() => onToggleLabel(label.id)}
              title={label.name === '…' ? t('archive_labels_vault_locked') : undefined}
              className={cn(
                sheet ? "min-h-11 gap-1.5 px-3 text-[14px] font-medium" : "gap-1 px-2 py-0.5 text-[10px] font-mono",
                "flex items-center rounded-full transition-colors border",
                active ? "border-transparent text-white" : "bg-transparent border-border-subtle text-text-main/60 hover:text-text-main/70"
              )}
              style={active ? { background: label.color, borderColor: label.color, boxShadow: `0 0 12px color-mix(in srgb, ${label.color} 45%, transparent)` } : {}}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: label.color }} />
              <span>{label.name}</span>
              <span className={cn(sheet ? "text-[12px]" : "font-mono text-[9px]", active ? "text-white/75" : "text-text-main/60")}>
                {labelCounts?.[label.id] ?? 0}
              </span>
            </Button>
            {showControls && (
              // Две кнопки 16 px вплотную, только десктоп: запас 44 px (IconButton) выключен —
              // у «Удалить» он накрывал карандаш и половину самой фишки.
              <span className="hidden md:flex absolute -top-1.5 -right-1.5 opacity-0 group-hover/label:opacity-100 transition-opacity gap-0.5">
                <IconButton
                  onClick={e => { e.stopPropagation(); setEditingLabelId(label.id); setEditLabelName(label.name); setEditLabelColor(label.color); }}
                  className="after:hidden w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/60 hover:text-text-main"
                  label={t('archive_label_rename')}
                  icon={<Pencil className="w-1.5 h-1.5" />}
                />
                <IconButton
                  onClick={e => { e.stopPropagation(); onDeleteLabel(label.id); }}
                  className="after:hidden w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/60 hover:text-accent-danger"
                  label={t('archive_label_delete')}
                  icon={<X className="w-1.5 h-1.5" />}
                />
              </span>
            )}
          </div>
        );
      })}
      {selectedLabels.length > 0 && (
        <Button
          onClick={() => selectedLabels.forEach(id => onToggleLabel(id))}
          className={cn(
            "rounded-full border border-dashed border-border-subtle text-text-main/60 hover:text-text-main transition-colors",
            sheet ? "min-h-11 px-3 text-[14px] font-medium" : "px-2 py-0.5 text-[10px] font-mono",
          )}
        >
          {t('archive_tags_reset')} ✕
        </Button>
      )}
      {/* Метку правили, а её удалили на другом устройстве — формы уже нет, кнопка нужна. */}
      {showControls && !addingLabel && !labels.some(l => l.id === editingLabelId) && (
        <Button
          onClick={() => setAddingLabel(true)}
           className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono text-text-main/60 hover:text-text-main border border-dashed border-border-subtle transition-colors"
        >
          + {t('archive_add_label')}
        </Button>
      )}
      {showControls && addingLabel && (
        <div className="flex items-center gap-2 px-2 py-1 rounded-xl border border-border-subtle bg-surface-card">
          <input
            value={newLabelName}
            readOnly={savingNewLabel}
            onChange={e => setNewLabelName(e.target.value)}
            placeholder={t('archive_label_name_placeholder')}
            aria-label={t('archive_label_name_placeholder')}
            autoFocus
            className="w-28 bg-transparent text-[12px] text-text-main outline-none placeholder:text-text-main/40"
            onKeyDown={e => {
              if (e.key === 'Enter') onAddLabel();
              if (e.key === 'Escape') { setAddingLabel(false); setNewLabelName(''); }
            }}
          />
          <div className="flex gap-1">
            {LABEL_PRESET_COLORS.map(c => (
              <Button
                key={c}
                style={{ background: c }}
                className={cn("w-4 h-4 rounded-full transition-colors p-0 min-w-0", newLabelColor === c && "ring-2 ring-offset-1 ring-offset-surface-card ring-text-main/40")}
                disabled={savingNewLabel}
                onClick={() => setNewLabelColor(c)}
                aria-label={t('archive_label_color_aria', { color: c })}
              />
            ))}
            <div className="relative">
              <input type="color" disabled={savingNewLabel} defaultValue={newLabelColor} onChange={e => setNewLabelColor(e.target.value)} className="sr-only" id="new-label-color" />
              <label htmlFor="new-label-color"
                className={cn("w-4 h-4 rounded-full border border-dashed border-border-subtle flex items-center justify-center cursor-pointer text-[9px] text-text-main/60 hover:border-text-main/40",
                  !LABEL_PRESET_COLORS.includes(newLabelColor) && "ring-2 ring-offset-1 ring-offset-surface-card"
                )}
                style={!LABEL_PRESET_COLORS.includes(newLabelColor) ? { background: newLabelColor } : {}}
              >
                {LABEL_PRESET_COLORS.includes(newLabelColor) && '+'}
              </label>
            </div>
          </div>
          <Button
            onClick={onAddLabel}
            disabled={!newLabelName.trim() || savingNewLabel}
            className="text-label-sm font-medium text-text-main/60 hover:text-text-main disabled:opacity-30 transition-colors"
          >
            {t('common_save')}
          </Button>
          <Button onClick={() => { setAddingLabel(false); setNewLabelName(''); }}
            className="text-label-sm text-text-main/60 hover:text-text-main transition-colors">
            ✕
          </Button>
        </div>
      )}
    </div>
  );
}
