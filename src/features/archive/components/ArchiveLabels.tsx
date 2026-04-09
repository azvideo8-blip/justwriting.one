import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { ProfileService } from '../../profile/services/ProfileService';
import { Label, UserProfile } from '../../../types';
import { Plus, X } from 'lucide-react';
import { cn } from '../../../core/utils/utils';

export function ArchiveLabels({ user, profile, selectedLabelId, onSelectLabel }: { user: User, profile: UserProfile | null, selectedLabelId: string | null, onSelectLabel: (id: string | null) => void }) {
  const labels: Label[] = profile?.labels || [];
  const [newLabel, setNewLabel] = useState({ name: '', color: '#000000' });

  const updateLabels = async (newLabels: Label[]) => {
    await ProfileService.updateLabels(user.uid, newLabels);
  };

  const addLabel = () => {
    if (newLabel.name) {
      updateLabels([...labels, { ...newLabel, id: Date.now().toString() }]);
      setNewLabel({ name: '', color: '#000000' });
    }
  };

  return (
    <div className="space-y-4 bg-surface-card p-6 rounded-3xl border border-border-subtle">
      <h3 className="text-xl font-bold">Бирки</h3>
      <div className="flex flex-wrap gap-2">
        {labels.map(label => (
          <button 
            key={label.id} 
            onClick={() => onSelectLabel(selectedLabelId === label.id ? null : label.id)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-white transition-all",
              selectedLabelId === label.id ? "ring-2 ring-offset-2 ring-text-main" : "opacity-80 hover:opacity-100"
            )} 
            style={{ backgroundColor: label.color }}
          >
            {label.name}
            <span onClick={(e) => { e.stopPropagation(); updateLabels(labels.filter(l => l.id !== label.id)); }}><X size={14} /></span>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="text" value={newLabel.name} onChange={e => setNewLabel({...newLabel, name: e.target.value})} placeholder="Название бирки" className="p-2 rounded-lg border border-border-subtle bg-transparent" />
        <input type="color" value={newLabel.color} onChange={e => setNewLabel({...newLabel, color: e.target.value})} className="p-1 rounded-lg border border-border-subtle bg-transparent" />
        <button onClick={addLabel} className="p-2 rounded-lg bg-text-main text-surface-base"><Plus size={20} /></button>
      </div>
    </div>
  );
}
