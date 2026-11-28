import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ProfileService, type LabelEdit } from '../../../core/services/ProfileService';
import { randomUUID } from '../../../core/storage/localDb';
import { Label } from '../../../types';
import { DocumentService } from '../../../core/services/DocumentService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { reportError } from '../../../shared/errors/reportError';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';

const EMPTY: Label[] = [];

// LB-1: список здесь — только то, что на экране. Правка его не читает: базу
// берёт ProfileService.editLabels из облака. Кэша на уровне модуля нет — он
// переживал экран и становился базой следующей правки.
const LABELS_RELOAD_MIN_MS = 30_000;
const LABELS_VISIBLE_MIN_MS = 5_000;

export function useProfileLabels(userId: string, initialLabels: Label[] = EMPTY) {
  // Свой список (чтение или итог правки) вместе с учёткой, которой он принадлежит:
  // после смены учётки чужой список не показывается.
  const [own, setOwn] = useState<{ userId: string; labels: Label[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const isVaultUnlocked = useEncryptionStore(s => s.isVaultUnlocked);
  const prevVaultUnlockedRef = useRef(isVaultUnlocked);
  // Номер принятого списка: ответ чтения, начатого до правки, старее её итога.
  const acceptedRef = useRef(0);
  // Учётка, для которой хук сейчас на экране ('' — ушли): ответы, начатые для
  // другой учётки или до ухода, не принимаются.
  const liveRef = useRef('');
  // id метки, которую уже пытались добавить с этим именем и цветом: повтор после
  // отказа идёт с тем же id, и состоявшаяся запись не даёт второй метки.
  const addIdsRef = useRef(new Map<string, string>());

  // До своего чтения — список из контекста профиля. После — только свой: из
  // контекста берутся одни имена, по id, для меток, чьё имя здесь не прочитано
  // (сейф заперт). Список контекста устаревает после правки, и взятый целиком
  // возвращал на экран удалённую метку.
  const labels = useMemo(() => {
    const mine = own?.userId === userId ? own.labels : null;
    if (!mine) return initialLabels.length > 0 ? initialLabels : EMPTY;
    const names = new Map(initialLabels.filter(l => !l._undecrypted && l.name !== '…').map(l => [l.id, l.name]));
    if (!mine.some(l => l._undecrypted && names.has(l.id))) return mine;
    return mine.map(l => (l._undecrypted && names.has(l.id) ? { id: l.id, name: names.get(l.id)!, color: l.color } : l));
  }, [own, userId, initialLabels]);

  useEffect(() => {
    liveRef.current = userId;
    const addIds = addIdsRef.current;
    return () => { liveRef.current = ''; addIds.clear(); };
  }, [userId]);

  const accept = useCallback((uid: string, list: Label[]) => {
    if (liveRef.current !== uid) return;
    acceptedRef.current++;
    setOwn({ userId: uid, labels: list });
  }, []);

  const load = useCallback((action: string, journalFailure = false) => {
    if (!userId || userId.startsWith('guest')) return;
    const startedAt = acceptedRef.current;
    ProfileService.getProfile(userId).then(result => {
      // Экран мог остаться со старым списком — это должно быть видно в журнале.
      if (result.error && journalFailure) reportError(new Error('LABELS_RELOAD_FAILED'), { action }, 'warning');
      // getProfile не бросает, а отдаёт { error } — тогда data пуст и список не трогаем.
      if (!result.data?.labels || acceptedRef.current !== startedAt) return;
      accept(userId, result.data.labels);
    }).catch(e => { reportError(e, { action }); });
  }, [userId, accept]);

  useEffect(() => { load('profileLabels/fetchProfile'); }, [load]);

  // DA-10 (владелец 27.11): метку, созданную на другом устройстве, открытая вкладка не
  // видела до перезагрузки — список читался один раз. Перечитываем при возврате во
  // вкладку и когда забор принёс изменения (не чаще раза в 30 с: событие частое).
  useEffect(() => {
    // Ревью DA-10: у возврата во вкладку и у события очереди — свои таймеры: частые
    // события очереди (и свои сохранения) не съедают перечитку по возврату.
    const last = { visible: 0, pulled: 0 };
    const reload = (kind: keyof typeof last, minMs: number) => {
      const now = Date.now();
      if (now - last[kind] < minMs) return;
      last[kind] = now;
      load(`profileLabels/fetchProfile_${kind}`);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') reload('visible', LABELS_VISIBLE_MIN_MS); };
    const onQueue = () => reload('pulled', LABELS_RELOAD_MIN_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('sync-queue-changed', onQueue);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('sync-queue-changed', onQueue);
    };
  }, [load]);

  // BUG-1: When vault unlocks, re-fetch to replace '…' placeholders with decrypted labels
  useEffect(() => {
    if (isVaultUnlocked && !prevVaultUnlockedRef.current) load('profileLabels/fetchProfile_unlock');
    prevVaultUnlockedRef.current = isVaultUnlocked;
  }, [isVaultUnlocked, load]);

  // true — правка в облаке; false — отказ (назван в журнале): вызывающий не закрывает
  // форму и не продолжает разрушительные шаги. Список на экране при отказе прежний.
  const edit = async (change: LabelEdit): Promise<boolean> => {
    setBusy(true);
    try {
      const startedAt = acceptedRef.current;
      const next = await ProfileService.editLabels(userId, change);
      const overlapped = acceptedRef.current !== startedAt;
      accept(userId, next);
      // Пока шла правка, экран принял другой список. Ответы приходят не в порядке
      // записей, так что какой из двух новее — знает только облако.
      if (overlapped) load('profileLabels/fetchProfile_overlap', true);
      return true;
    } catch (error) {
      reportError(error, { action: 'profileLabels/updateLabels' });
      // Метку удалили на другом устройстве — экран отстал, показываем, что есть.
      if (error instanceof Error && error.message === 'LABEL_GONE') load('profileLabels/fetchProfile_gone', true);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addLabel = async (label: Omit<Label, 'id'>): Promise<boolean> => {
    const key = `${label.name}\n${label.color}`;
    const id = addIdsRef.current.get(key) ?? randomUUID();
    addIdsRef.current.set(key, id);
    const ok = await edit({ add: { id, name: label.name, color: label.color } });
    if (ok) addIdsRef.current.delete(key);
    return ok;
  };

  // Что изменилось, решает форма (useLabelEditor) по значениям на момент открытия;
  // сюда приходят только изменённые поля.
  const updateLabel = async (labelId: string, updates: { name?: string | undefined; color?: string | undefined }): Promise<boolean> => {
    const ok = await edit({ update: { id: labelId, name: updates.name, color: updates.color } });
    // Метка теперь другая: её id больше не значит «то, что пытались добавить».
    if (ok) for (const [key, id] of addIdsRef.current) if (id === labelId) addIdsRef.current.delete(key);
    return ok;
  };

  const removeLabel = async (labelId: string): Promise<boolean> => {
    // Метка осталась в профиле — с заметок её не снимаем.
    if (!(await edit({ remove: labelId }))) return false;
    if (!userId.startsWith('guest')) {
      DocumentService.clearLabelFromAllDocs(userId, labelId).catch(e => { reportError(e, { action: 'profileLabels/clearLabelFromCloudDocs' }); });
    }
    LocalDocumentService.clearLabelFromAllDocs(userId, labelId).catch(e => { reportError(e, { action: 'profileLabels/clearLabelFromLocalDocs' }); });
    return true;
  };

  return { labels, addLabel, updateLabel, removeLabel, loading: busy };
}
