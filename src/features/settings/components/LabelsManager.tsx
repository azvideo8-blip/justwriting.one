import React, { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { Label } from '../../../types';

const PRESET_COLORS = ['#7C6DFA', '#34D399', '#F97316', '#EC4899', '#60A5FA', '#FBBF24'];

interface LabelsManagerProps {
  labels: Label[];
  addLabel: (label: Omit<Label, 'id'>) => void;
  removeLabel: (labelId: string) => void;
}

export function LabelsManager({ labels, addLabel, removeLabel }: LabelsManagerProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);

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
          <div className="flex gap-2">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                style={{ background: c }}
                className={cn("w-6 h-6 rounded-full transition-all", selectedColor === c && "ring-2 ring-offset-2 ring-offset-surface-card")}
                onClick={() => setSelectedColor(c)}
              />
            ))}
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
