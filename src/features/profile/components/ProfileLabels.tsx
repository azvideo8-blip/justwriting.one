import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { UserProfile } from '../../../types';
import { Plus, X } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { useProfileLabels } from '../hooks/useProfileLabels';

export function ProfileLabels({ user, profile }: { user: User, profile: UserProfile | null }) {
  const { labels, addLabel, removeLabel } = useProfileLabels(user.uid, profile?.labels || []);
  const [newLabel, setNewLabel] = useState({ name: '', color: '#000000' });

  const handleAddLabel = () => {
    if (newLabel.name) {
      addLabel(newLabel);
      setNewLabel({ name: '', color: '#000000' });
    }
  };

  return (
    <div className="space-y-4 p-6 rounded-3xl transition-all bg-surface-card backdrop-blur-xl border border-border-subtle shadow-sm">
      <h3 className="text-xl font-bold text-text-main">Бирки</h3>
      <div className="flex flex-wrap gap-2">
        {labels.map(label => (
          <div key={label.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-white" style={{ backgroundColor: label.color }}>
            {label.name}
            <button onClick={() => removeLabel(label.id)} className="hover:opacity-70 transition-opacity"><X size={14} /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input 
          type="text" 
          value={newLabel.name} 
          onChange={e => setNewLabel({...newLabel, name: e.target.value})} 
          placeholder="Название бирки" 
          className="p-2 rounded-lg border bg-transparent outline-none flex-1 border-border-subtle text-text-main placeholder:text-text-main/30 focus:border-text-main/30"
        />
        <input 
          type="color" 
          value={newLabel.color} 
          onChange={e => setNewLabel({...newLabel, color: e.target.value})} 
          className="p-1 rounded-lg border bg-transparent h-10 w-10 cursor-pointer border-border-subtle"
        />
        <button 
          onClick={handleAddLabel} 
          className="p-2 rounded-lg transition-colors flex items-center justify-center bg-text-main text-surface-base hover:opacity-90"
        >
          <Plus size={20} />
        </button>
      </div>
    </div>
  );
}
