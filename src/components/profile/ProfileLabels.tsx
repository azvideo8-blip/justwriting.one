import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { UserService } from '../../services/UserService';
import { Label } from '../../types';
import { Plus, X } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';
import { cn } from '../../core/utils/utils';

export function ProfileLabels({ user, profile }: { user: User, profile: any }) {
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';
  const labels: Label[] = profile?.labels || [];
  const [newLabel, setNewLabel] = useState({ name: '', color: '#000000' });

  const updateLabels = async (newLabels: Label[]) => {
    await UserService.updateLabels(user.uid, newLabels);
  };

  const addLabel = () => {
    if (newLabel.name) {
      updateLabels([...labels, { ...newLabel, id: Date.now().toString() }]);
      setNewLabel({ name: '', color: '#000000' });
    }
  };

  return (
    <div className={cn(
      "space-y-4 p-6 rounded-3xl transition-all",
      isV2 
        ? "bg-white/5 backdrop-blur-xl border border-white/10 text-[#E5E5E0]" 
        : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-sm"
    )}>
      <h3 className={cn("text-xl font-bold", isV2 ? "text-white" : "dark:text-stone-100")}>Бирки</h3>
      <div className="flex flex-wrap gap-2">
        {labels.map(label => (
          <div key={label.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-white" style={{ backgroundColor: label.color }}>
            {label.name}
            <button onClick={() => updateLabels(labels.filter(l => l.id !== label.id))} className="hover:opacity-70 transition-opacity"><X size={14} /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input 
          type="text" 
          value={newLabel.name} 
          onChange={e => setNewLabel({...newLabel, name: e.target.value})} 
          placeholder="Название бирки" 
          className={cn(
            "p-2 rounded-lg border bg-transparent outline-none flex-1",
            isV2 
              ? "border-white/10 text-white placeholder:text-white/30 focus:border-white/30" 
              : "border-stone-200 dark:border-stone-700 dark:text-stone-100 focus:border-stone-300"
          )} 
        />
        <input 
          type="color" 
          value={newLabel.color} 
          onChange={e => setNewLabel({...newLabel, color: e.target.value})} 
          className={cn(
            "p-1 rounded-lg border bg-transparent h-10 w-10 cursor-pointer",
            isV2 ? "border-white/10" : "border-stone-200 dark:border-stone-700"
          )} 
        />
        <button 
          onClick={addLabel} 
          className={cn(
            "p-2 rounded-lg transition-colors flex items-center justify-center",
            isV2 
              ? "bg-white text-black hover:bg-white/90" 
              : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-800 dark:hover:bg-stone-200"
          )}
        >
          <Plus size={20} />
        </button>
      </div>
    </div>
  );
}
