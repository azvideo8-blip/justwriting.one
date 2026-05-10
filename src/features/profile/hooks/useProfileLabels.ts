import { useState, useEffect, useRef } from 'react';
import { ProfileService } from '../services/ProfileService';
import { randomUUID } from '../../../shared/lib/localDb';
import { Label } from '../../../types';

const labelCache = new Map<string, Label[]>();

export function useProfileLabels(userId: string, initialLabels: Label[] = []) {
  const cached = labelCache.get(userId);
  const [labels, setLabels] = useState<Label[]>(cached ?? initialLabels);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (initialLabels.length > 0 && !labelCache.has(userId)) {
      labelCache.set(userId, initialLabels);
    }
  }, [initialLabels, userId]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    ProfileService.getProfile(userId).then(p => {
      if (p?.labels) {
        labelCache.set(userId, p.labels);
        setLabels(p.labels);
      }
    }).catch(() => {});
  }, [userId]);

  const updateLabels = async (newLabels: Label[]) => {
    setLoading(true);
    try {
      await ProfileService.updateLabels(userId, newLabels);
      labelCache.set(userId, newLabels);
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
