import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { Label } from '../../../types';
import { LABEL_PRESET_COLORS } from '../../../core/constants/labelColors';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { Input } from '../../../shared/components/Input';



interface LabelsManagerProps {
  labels: Label[];
  addLabel: (label: Omit<Label, 'id'>) => void;
  removeLabel: (labelId: string) => void;
}

export function LabelsManager({ labels, addLabel, removeLabel }: LabelsManagerProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState<string>(LABEL_PRESET_COLORS[0]!);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addLabel({ name: trimmed, color: selectedColor });
    setName('');
    setAdding(false);
  };

  return (
    <>
      {labels.map(label => (
        <div key={label.id} className="flex items-center gap-3 py-2 px-4 rounded-xl border border-border-subtle">
          <div className="w-3 h-3 rounded-full shrink-0" style={label.color ? { background: label.color } : undefined} />
          <span className="text-sm text-text-main flex-1">{label.name}</span>
          <IconButton onClick={() => removeLabel(label.id)} className="p-1" label="Remove label" icon={<X size={14} className="text-text-main/60 hover:text-accent-danger transition-colors" />} />
        </div>
      ))}

      {adding ? (
        <div className="mt-2 space-y-3 p-4 rounded-xl border border-border-subtle">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Label name"
            className="px-3 py-2 rounded-lg border border-border-subtle bg-surface-base text-sm text-text-main placeholder:text-text-main/40 outline-none focus:border-text-main/40 transition-colors"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          />
          <div className="flex flex-wrap gap-1 -m-2">
            {LABEL_PRESET_COLORS.map(c => (
              <div key={c} className="w-11 h-11 flex items-center justify-center">
                <Button
                  style={c ? { background: c } : undefined}
                  className={cn("w-6 h-6 rounded-full transition-colors p-0 min-w-0", selectedColor === c && "ring-2 ring-offset-2 ring-offset-surface-card")}
                  onClick={() => setSelectedColor(c)}
                  aria-label={c ? `Select color ${c}` : 'Select default color'}
                />
              </div>
            ))}
            <div className="w-11 h-11 flex items-center justify-center">
              <div className="relative">
                <input
                  type="color"
                  defaultValue={selectedColor}
                  onChange={e => setSelectedColor(e.target.value)}
                  className="sr-only"
                  id="label-color-custom-settings"
                />
                <label
                  htmlFor="label-color-custom-settings"
                  className={cn(
                    "w-6 h-6 rounded-full border-2 border-dashed border-border-subtle flex items-center justify-center cursor-pointer transition-colors hover:border-text-main/40",
                    !LABEL_PRESET_COLORS.includes(selectedColor) && "ring-2 ring-offset-2 ring-offset-surface-card ring-text-main/30"
                  )}
                  style={!LABEL_PRESET_COLORS.includes(selectedColor) ? { background: selectedColor } : {}}
                >
                  {LABEL_PRESET_COLORS.includes(selectedColor) && (
                    <span className="text-label-sm text-text-main/60 font-bold leading-none">+</span>
                  )}
                </label>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleAdd}
              disabled={!name.trim()}
              className="px-4 py-2 rounded-lg bg-text-main text-surface-base text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Add
            </Button>
            <Button
              onClick={() => { setAdding(false); setName(''); }}
              className="px-4 py-2 rounded-lg text-sm text-text-main/60 hover:text-text-main transition-colors"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => setAdding(true)}
          className="w-full px-4 py-3 rounded-xl border border-dashed border-border-subtle text-sm text-text-main/60 hover:text-text-main/60 hover:border-border-subtle/80 transition-colors"
        >
          + Add label
        </Button>
      )}
    </>
  );
}
