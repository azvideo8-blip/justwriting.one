import { DataProvider } from '../../../core/data';
import { getLocalDb, LocalDraft } from '../../../core/storage/localDb';
import { maybeEncrypt, isProfileLoaded } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { cloudSyncEnabled } from '../../../core/sync/cloudSyncEnabled';
import { pushSentHash } from '../../../core/sync/sentHashes';
import {
  applyWrite,
  isEpochStale,
  getDraftGeneration,
  queueDraftRowWrite,
  clearPendingCloudDelete,
  draftSignature,
  draftPayloadHash,
  draftSentHashes,
  isCloudDraftUnread,
  lastCloudSignature,
  type ApplyWriteOutcome,
  type DraftRecord,
  type DraftWriteBasis,
} from './draftWriter';
const DRAFT_CLOUD_FIELDS: Record<string, boolean> = {
  // Признак шифрования обязан уезжать вместе с данными. Без него колонка в
  // облаке хранит шифротекст, а читающая сторона считает его открытым текстом:
  // maybeDecrypt пытается разобрать pinnedThoughts как JSON, разбор падает — и
  // поле заменяется пустым массивом. Закреплённые мысли исчезали молча.
  _encrypted: true,
  content: true,
  title: true,
  pinnedThoughts: true,
  tags: true,
  labelId: true,
  wordCount: true,
  initialWordCount: true,
  activeSessionId: true,
  savedDocumentId: true,
  sessionStartTime: true,
  updatedAt: true,
};

export const WritingDraftService = {
  getDraftGeneration,

  clearLegacyDraft: async (userId: string) => {
    try {
      localStorage.removeItem(STORAGE_KEYS.DRAFT(userId));
    } catch (e) { reportError(e, { action: 'clearLegacyDraft', userId }); }
  },

  /** 'written' — записано; другой итог мутатора — пропуск: черновик устарел
   *  (`'stale-epoch'`: эпоху подняли сохранение заметки, удаление или конец
   *  сессии), у записи нет владельца (`'no-owner'`) или он назван чужой
   *  (`'owner-mismatch'`). Пропуск — не запись, и «Сохранено» по нему показывать
   *  нельзя (N-33). */
  saveToLocal: async (draft: LocalDraft, generation?: number): Promise<ApplyWriteOutcome> => {
    if (!draft.userId) {
      return 'no-owner';
    }
    // DW4-2: единственный писатель строки — мутатор `applyWrite` (draftWriter).
    // Шаг 5: эпоху писатель либо называет явно, либо приносит в строке
    // (`buildLocalDraft`); фоново принятое из облака кэширование эпохи не имеет
    // и не сверяется.
    const epoch = generation ?? (typeof draft.epoch === 'number' ? draft.epoch : undefined);
    const basis: DraftWriteBasis = epoch !== undefined ? 'edit' : 'adopt-cloud';
    return applyWrite(draft as unknown as DraftRecord, basis, {
      uid: draft.userId,
      epoch,
    });
  },

  /**
   * SF2-1/SF-2: запомнить отправку черновика в облако.
   *
   * Вызывается ДВАЖДЫ на одну запись: до запроса — с хэшем уехавшей нагрузки, и
   * после принятого ответа — с ним же плюс серверная метка принятой версии (тот
   * же смысл, что `markCloudSeen` у заметок). Порядок важен: ответ на запись
   * рвётся уже после коммита на сервере, и если хэш писать только по успеху,
   * своя же дошедшая копия на следующей загрузке выглядит чужой и затирает
   * дописанное.
   *
   * Локальной копии нет — отметки нет: нечего помечать, а не «облако пустое».
   *
   * SF3-1: принятая запись закрывает список. Его смысл — «уехало и ответа мы не
   * видели», а с ответом на эту же нагрузку все прежние отправки становятся либо
   * той версией, которая под этой уже лежит в облаке, либо тем, что туда не
   * попало никогда. Держать их дальше — это и рост списка, и будущее «наше» по
   * содержимому, которое перестало быть нашим.
   */
  rememberCloudSend: async (
    userId: string,
    hash: string,
    accepted?: { stampMs?: number | null },
  ): Promise<void> => {
    if (!userId || !hash) return;
    try {
      const localDb = await getLocalDb(userId);
      await queueDraftRowWrite(async () => {
        const tx = localDb.transaction('drafts', 'readwrite');
        // Safari обрывает транзакцию при уходе в фон: бросает `get`, а `done` без
        // слушателя становится unhandledrejection рядом с уже записанной ошибкой.
        void tx.done.catch(() => undefined);
        const stored = await tx.store.get(userId);
        if (stored) {
          const next: LocalDraft = { ...stored, _cloudSentHashes: pushSentHash(draftSentHashes(stored), hash) };
          if (accepted) {
            next._cloudAckedHash = hash;
            next._cloudSentHashes = [hash];
            const stampMs = accepted.stampMs;
            if (typeof stampMs === 'number' && Number.isFinite(stampMs)) next._cloudUpdatedAt = stampMs;
          }
          await tx.store.put(next);
        }
        await tx.done;
      });
    } catch (err) {
      // Служебная метка: текст это не затрагивает, следующий спор копий решит прежнее правило.
      reportError(err, { action: 'rememberDraftCloudSend', userId }, 'warning');
    }
  },

  // Раньше называлось saveToFirestore, и это же имя уходило в журнал ошибок.
  // Firestore здесь нет с момента переезда — внутри DataProvider.saveDraft, то
  // есть Supabase, — но сообщение «Firestore save failed» отправляло искать
  // причину в мёртвом слое. Имя в журнале должно называть то место, где отказ
  // случился на самом деле.
  saveDraftToCloud: async (draft: LocalDraft, generation?: number): Promise<boolean> => {
    if (!draft.userId) return false;
    // DW5-3.4: в облаке у аккаунта один ряд черновика, и запись с чужим `owner`
    // — это I3 уже в облачной половине. Локальную половину отсекает мутатор, здесь
    // та же сверка одной строкой. Строки до 0.11.5 владельца не несут — их это
    // вето не касается.
    if (typeof draft.owner === 'string' && draft.owner !== draft.userId) return false;
    if (!cloudSyncEnabled(draft.userId)) return false;
    if (!isProfileLoaded(draft.userId)) {
      return false;
    }
    if (isCloudDraftUnread(draft.userId)) return false;
    // Шаг 5 DW-4: облачная половина сверяется по тому же правилу эпохи, что и
    // локальная (`draftWriter.isEpochStale`), и по той же отметке — названной
    // писателем или принесённой строкой. Признак «ничего не изменилось»
    // (`lastCloudSignature`) и 60-секундный коридор SF-2 остаются как есть:
    // это тормоз облачной квоты, а не защита порядка (§4.4).
    const epoch = generation ?? (typeof draft.epoch === 'number' ? draft.epoch : undefined);
    if (isEpochStale(draft.userId, epoch)) {
      return false;
    }
    // Nothing worth writing changed since the last successful write. Reported as
    // success: the cloud copy IS current, which is what the caller's staleness
    // flag asks about.
    const signature = draftSignature(draft);
    if (lastCloudSignature.get(draft.userId) === signature) return true;
    const hash = draftPayloadHash(draft);

    const draftRecord = draft as unknown as Record<string, unknown>;
    const encrypted = await maybeEncrypt(draftRecord, ['content', 'title'], ['pinnedThoughts', 'tags'], draft.userId);
    if (isEpochStale(draft.userId, epoch)) {
      return false;
    }
    const clean = Object.fromEntries(
      Object.entries(encrypted).filter(([k, v]) => v !== undefined && (k in DRAFT_CLOUD_FIELDS))
    );
    try {
      if (isEpochStale(draft.userId, epoch)) {
        return false;
      }
      // SF2-1: хэш уехавшей нагрузки фиксируется ДО запроса. Ответ может
      // оборваться уже после коммита на сервере — тогда при следующей загрузке
      // облачная строка будет нашей, а не чужой, и локальный набор не сотрётся.
      await WritingDraftService.rememberCloudSend(draft.userId, hash);
      // DW6-5.3: `rememberCloudSend` ждёт очередь строки — это точка, в которой
      // запись может простоять сколько угодно. Пока она ждала, черновик могли
      // закрыть (сохранение заметки, «Удалить»): подъём эпохи обязан остановить и
      // облачную половину, иначе опоздавшая нагрузка легла бы поверх закрытого.
      if (isEpochStale(draft.userId, epoch)) {
        return false;
      }
      const cloudStamp = await DataProvider.saveDraft(draft.userId, clean);
      lastCloudSignature.set(draft.userId, signature);
      // SF-2: метку принятой версии двигаем ТОЛЬКО на принятой записи. Отказ или
      // разрыв ответа — «не знаю», и прежняя метка остаётся: на «не знаю»
      // правило хранит локальную.
      await WritingDraftService.rememberCloudSend(draft.userId, hash, { stampMs: cloudStamp });
      // Облако держит одну строку черновика: принятая запись нового черновика
      // заменила удалённый — досылать удаление больше нечего (иначе оно стёрло бы
      // этот новый черновик при следующей загрузке; приёмка 0.10.6).
      clearPendingCloudDelete(draft.userId);
      return true;
    } catch (e) {
      if (isEpochStale(draft.userId, epoch)) {
        return false;
      }
      reportError(e, { action: 'saveDraftToCloud', userId: draft.userId });
      throw e;
    }
  },

};
