import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Label, UserProfile } from '../../types';
import { Plus, X } from 'lucide-react';
import { handleFirestoreError, OperationType } from '../../lib/firestore-errors';

export function ProfileLabels({ user, profile }: { user: User, profile: UserProfile | null }) {
  const labels: Label[] = profile?.labels || [];
  const [newLabel, setNewLabel] = useState({ name: '', color: '#000000' });

  const updateLabels = async (newLabels: Label[]) => {
    try {
      await updateDoc(doc(db, 'users', user.uid), { labels: newLabels });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const addLabel = () => {
    if (newLabel.name) {
      updateLabels([...labels, { ...newLabel, id: Date.now().toString() }]);
      setNewLabel({ name: '', color: '#000000' });
    }
  };

  return (
    <div className="space-y-4 bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-200 dark:border-stone-800">
      <h3 className="text-xl font-bold">Бирки</h3>
      <div className="flex flex-wrap gap-2">
        {labels.map(label => (
          <div key={label.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-white" style={{ backgroundColor: label.color }}>
            {label.name}
            <button onClick={() => updateLabels(labels.filter(l => l.id !== label.id))}><X size={14} /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="text" value={newLabel.name} onChange={e => setNewLabel({...newLabel, name: e.target.value})} placeholder="Название бирки" className="p-2 rounded-lg border bg-transparent" />
        <input type="color" value={newLabel.color} onChange={e => setNewLabel({...newLabel, color: e.target.value})} className="p-1 rounded-lg border bg-transparent" />
        <button onClick={addLabel} className="p-2 rounded-lg bg-stone-900 text-white"><Plus size={20} /></button>
      </div>
    </div>
  );
}