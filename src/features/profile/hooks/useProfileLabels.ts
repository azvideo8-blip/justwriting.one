import { useState, useEffect, useRef } from 'react';
import { ProfileService } from '../../../core/services/ProfileService';
import { randomUUID } from '../../../core/storage/localDb';
import { Label } from '../../../types';
import { DocumentService } from '../../../core/services/DocumentService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { reportError } from '../../../shared/errors/reportError';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';

const labelCache = new Map<string, Label[]>();
const fetchedSet = new Set<string>();

export function useProfileLabels(userId: string, initialLabels: Label[] = []) {
  const cached = labelCache.get(userId);
  const [labels, setLabels] = useState<Label[]>(cached ?? initialLabels);
  const [busy, setBusy] = useState(false);
  const isVaultUnlocked = useEncryptionStore(s => s.isVaultUnlocked);
  const prevVaultUnlockedRef = useRef(isVaultUnlocked);

  useEffect(() => {
    if (initialLabels.length > 0) {
      const hasRealNames = initialLabels.some(l => l.name.length > 0 && l.name !== '…');
      const currentHasPlaceholdersOnly = labels.length === 0 || labels.every(l => l.name === '…');
      if (!labelCache.has(userId) || (hasRealNames && currentHasPlaceholdersOnly)) {
        labelCache.set(userId, initialLabels);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- guarded by currentHasPlaceholdersOnly and labelCache check to prevent cascading re-renders
        setLabels(initialLabels);
      }
    }
  }, [initialLabels, userId, labels]);

  useEffect(() => {
    if (fetchedSet.has(userId) || !userId || userId.startsWith('guest')) return;
    ProfileService.getProfile(userId).then(result => {
      // N-54: getProfile не бросает, а отдаёт { error }. Неудачное чтение не
      // считается прочитанным — иначе метки остаются «…» до перезагрузки.
      if (result.error) return;
      fetchedSet.add(userId);
      if (result.data?.labels) {
        const fetched = result.data.labels;
        labelCache.set(userId, fetched);
        setLabels(fetched);
      }
    }).catch(e => { reportError(e, { action: 'profileLabels/fetchProfile' }); });
  }, [userId]);

  // BUG-1: When vault unlocks, clear stale cached '…' placeholders and re-fetch decrypted labels
  useEffect(() => {
    if (isVaultUnlocked && !prevVaultUnlockedRef.current && userId && !userId.startsWith('guest')) {
      labelCache.delete(userId);
      fetchedSet.delete(userId);
      ProfileService.getProfile(userId).then(result => {
        // N-54: getProfile не бросает, а отдаёт { error }. Неудачное чтение не
        // считается прочитанным — иначе метки остаются «…» до перезагрузки.
        if (result.error) return;
        fetchedSet.add(userId);
        if (result.data?.labels) {
          const fetched = result.data.labels;
          labelCache.set(userId, fetched);
          setLabels(fetched);
        }
      }).catch(e => { reportError(e, { action: 'profileLabels/fetchProfile_unlock' }); });
    }
    prevVaultUnlockedRef.current = isVaultUnlocked;
  }, [isVaultUnlocked, userId]);

  useEffect(() => {
    return () => {
      labelCache.delete(userId);
      fetchedSet.delete(userId);
    };
  }, [userId]);

  // true — метки сохранены; false — отказ (назван в журнале): вызывающий не закрывает
  // форму и не продолжает разрушительные шаги.
  const updateLabels = async (newLabels: Label[]): Promise<boolean> => {
    setBusy(true);
    try {
      await ProfileService.updateLabels(userId, newLabels);
      labelCache.set(userId, newLabels);
      setLabels(newLabels);
      return true;
    } catch (error) {
      reportError(error, { action: 'profileLabels/updateLabels' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addLabel = async (label: Omit<Label, 'id'>): Promise<boolean> => {
    const newLabel: Label = { ...label, id: randomUUID() };
    // Кэш новее замыкания: в нём и прочитанное, и только что сохранённое.
    let current = labelCache.get(userId) ?? labels;
    // Н-4: пустой список, который так и не прочитали, — не «меток нет». Запись
    // заменяет весь список, и новая метка стёрла бы остальные. Условие — по кэшу,
    // а не по отметке «прочитано»: она ставится и поздним ответом после ухода с экрана.
    if (current.length === 0 && !labelCache.has(userId) && userId && !userId.startsWith('guest')) {
      const res = await ProfileService.getProfile(userId);
      if (res.error) return false; // отказ уже в журнале (getProfile)
      current = res.data?.labels ?? [];
      labelCache.set(userId, current);
      setLabels(current);
    }
    return updateLabels([...current, newLabel]);
  };

  const updateLabel = (labelId: string, updates: Partial<Omit<Label, 'id'>>): Promise<boolean> => {
    const newLabels = labels.map(l => l.id === labelId ? { ...l, ...updates } : l);
    return updateLabels(newLabels);
  };

  const removeLabel = async (labelId: string): Promise<boolean> => {
    // Метка осталась в профиле — с заметок её не снимаем.
    if (!(await updateLabels(labels.filter(l => l.id !== labelId)))) return false;
    if (!userId.startsWith('guest')) {
      DocumentService.clearLabelFromAllDocs(userId, labelId).catch(e => { reportError(e, { action: 'profileLabels/clearLabelFromCloudDocs' }); });
    }
    LocalDocumentService.clearLabelFromAllDocs(userId, labelId).catch(e => { reportError(e, { action: 'profileLabels/clearLabelFromLocalDocs' }); });
    return true;
  };

  return { labels, addLabel, updateLabel, removeLabel, loading: busy };
}
