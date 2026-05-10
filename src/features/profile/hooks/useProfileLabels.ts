import { useState, useEffect, useRef } from 'react';
import { ProfileService } from '../services/ProfileService';
import { randomUUID } from '../../../shared/lib/localDb';
import { Label } from '../../../types';

export function useProfileLabels(userId: string, initialLabels: Label[] = []) {
  const [labels, setLabels] = useState<Label[]>(initialLabels);
  const [loading, setLoading] = useState(false);

  // Sync once when profile loads asynchronously (initialLabels starts as [] when profile is null)
  const synced = useRef(false);
  useEffect(() => {
    if (!synced.current && initialLabels.length > 0) {
      synced.current = true;
      setLabels(initialLabels);
    }
  }, [initialLabels]);

  const updateLabels = async (newLabels: Label[]) => {
    setLoading(true);
    try {
      await ProfileService.updateLabels(userId, newLabels);
      setLabels(newLabels);
    } catch (error) {
      console.error('Error updating profile labels:', error);
    } finally {
      setLoading(false);
    }
  };

  const addLabel = (label: Omit<Label, 'id'>) => {
    const newLabel: Label = { ...label, id: randomUUID() };
    updateLabels([...labels, newLabel]);
  };

  const removeLabel = (labelId: string) => {
    updateLabels(labels.filter(l => l.id !== labelId));
  };

  return { labels, addLabel, removeLabel, loading };
}
