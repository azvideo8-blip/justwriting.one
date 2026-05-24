import React, { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { Label } from '../../../types';
import { LABEL_PRESET_COLORS } from '../../../core/constants/labelColors';



interface LabelsManagerProps {
  labels: Label[];
  addLabel: (label: Omit<Label, 'id'>) => void;
  removeLabel: (labelId: string) => void;
}

export function LabelsManager({ labels, addLabel, removeLabel }: LabelsManagerProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(LABEL_PRESET_COLORS[0]);

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
          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: label.color }} />
          <span className="text-sm text-text-main flex-1">{label.name}</span>
          <button onClick={() => removeLabel(label.id)} className="p-1">
            <X size={14} className="text-text-main/30 hover:text-red-400 transition-colors" />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="mt-2 space-y-3 p-4 rounded-xl border border-border-subtle">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Label name"
            className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface-base text-sm text-text-main placeholder:text-text-main/30 outline-none focus:border-text-main/40 transition-colors"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          />
          <div className="flex flex-wrap gap-1 -m-2">
            {LABEL_PRESET_COLORS.map(c => (
              <div key={c} className="w-11 h-11 flex items-center justify-center">
                <button
                  type="button"
                  style={{ background: c }}
                  className={cn("w-6 h-6 rounded-full transition-all", selectedColor === c && "ring-2 ring-offset-2 ring-offset-surface-card")}
                  onClick={() => setSelectedColor(c)}
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
                    "w-6 h-6 rounded-full border-2 border-dashed border-border-subtle flex items-center justify-center cursor-pointer transition-all hover:border-text-main/40",
                    !LABEL_PRESET_COLORS.includes(selectedColor) && "ring-2 ring-offset-2 ring-offset-surface-card ring-text-main/30"
                  )}
                  style={!LABEL_PRESET_COLORS.includes(selectedColor) ? { background: selectedColor } : {}}
                >
                  {LABEL_PRESET_COLORS.includes(selectedColor) && (
                    <span className="text-[11px] text-text-main/40 font-bold leading-none">+</span>
                  )}
                </label>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!name.trim()}
              className="px-4 py-2 rounded-lg bg-text-main text-surface-base text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Add
            </button>
            <button
              onClick={() => { setAdding(false); setName(''); }}
              className="px-4 py-2 rounded-lg text-sm text-text-main/50 hover:text-text-main transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full px-4 py-3 rounded-xl border border-dashed border-border-subtle text-sm text-text-main/40 hover:text-text-main/60 hover:border-border-subtle/80 transition-all"
        >
          + Add label
        </button>
      )}
    </>
  );
}
