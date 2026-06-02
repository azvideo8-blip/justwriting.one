import { useState, useEffect } from 'react';
import { ProfileService } from '../services/ProfileService';
import { randomUUID } from '../../../core/storage/localDb';
import { Label } from '../../../types';
import { DocumentService } from '../../../core/services/DocumentService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { reportError } from '../../../shared/errors/reportError';

const labelCache = new Map<string, Label[]>();
const fetchedSet = new Set<string>();

export function useProfileLabels(userId: string, initialLabels: Label[] = []) {
  const cached = labelCache.get(userId);
  const [labels, setLabels] = useState<Label[]>(cached ?? initialLabels);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialLabels.length > 0 && !labelCache.has(userId)) {
      labelCache.set(userId, initialLabels);
      setLabels(initialLabels);
    }
  }, [initialLabels, userId]);

  useEffect(() => {
    if (fetchedSet.has(userId) || !userId || userId.startsWith('guest')) return;
    ProfileService.getProfile(userId).then(result => {
      fetchedSet.add(userId);
      if (!result.error && result.data?.labels) {
        const labels = result.data.labels as Label[];
        labelCache.set(userId, labels);
        setLabels(labels);
      }
    }).catch(e => { reportError(e, { action: 'profileLabels/fetchProfile' }); });
  }, [userId]);

  useEffect(() => {
    return () => {
      labelCache.delete(userId);
      fetchedSet.delete(userId);
    };
  }, [userId]);

  const updateLabels = async (newLabels: Label[]) => {
    setLoading(true);
    try {
      await ProfileService.updateLabels(userId, newLabels);
      labelCache.set(userId, newLabels);
      setLabels(newLabels);
    } catch (error) {
      reportError(error, { action: 'profileLabels/updateLabels' });
    } finally {
      setLoading(false);
    }
  };

  const addLabel = (label: Omit<Label, 'id'>) => {
    const newLabel: Label = { ...label, id: randomUUID() };
    void updateLabels([...labels, newLabel]);
  };

  const updateLabel = (labelId: string, updates: Partial<Omit<Label, 'id'>>) => {
    const newLabels = labels.map(l => l.id === labelId ? { ...l, ...updates } : l);
    void updateLabels(newLabels);
  };

  const removeLabel = async (labelId: string) => {
    await updateLabels(labels.filter(l => l.id !== labelId));
    if (!userId.startsWith('guest')) {
      DocumentService.clearLabelFromAllDocs(userId, labelId).catch(e => { reportError(e, { action: 'profileLabels/clearLabelFromCloudDocs' }); });
    }
    LocalDocumentService.clearLabelFromAllDocs(userId, labelId).catch(e => { reportError(e, { action: 'profileLabels/clearLabelFromLocalDocs' }); });
  };

  return { labels, addLabel, updateLabel, removeLabel, loading };
}
