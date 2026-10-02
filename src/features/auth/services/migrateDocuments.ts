import { getOrCreateGuestId, getLocalDb, type LocalDraft } from '../../../core/storage/localDb';
import { LocalStorageService } from '../../../core/services/LocalStorageService';
import { GUEST_DRAFT_TTL_MS, STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { emitDomainEvent } from '../../../core/events/domainEvents';
import { getFrozenDates, saveFrozenDates, clearFrozenDates } from '../../../core/utils/streakFreeze';
import { reportError } from '../../../shared/errors/reportError';

export interface MigrateResult {
  moved: number;
  left: number;
}

type GuestDb = Awaited<ReturnType<typeof getLocalDb>>;

/**
 * S-44.4 (S-8): черновик гостя лежит в IndexedDB и/или в localStorage (запись
 * идёт в оба, см. GuestDraftService). Окно переноса и сам перенос должны видеть
 * один и тот же черновик: новейший из двух копий и не старше 7 дней — иначе
 * окно считало копию из localStorage, перенос её не трогал, и предложение
 * «перенесено 1» возвращалось при каждой загрузке.
 */
const ts = (d: LocalDraft | undefined) => d?.updatedAt ?? (d as { timestamp?: number } | undefined)?.timestamp ?? 0;

/** «Черновик гостя, 2 октября 2026» — заголовок заметки, в которую уходит неперенесённый черновик. */
export function guestDraftNoteTitle(at: number, lang = localStorage.getItem(STORAGE_KEYS.APP_LANGUAGE) === 'en' ? 'en' : 'ru'): string {
  const date = new Date(at).toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  return lang === 'en' ? `Guest draft, ${date}` : `Черновик гостя, ${date}`;
}

export async function readGuestDraft(guestDb: GuestDb): Promise<LocalDraft | null> {
  const idb = guestDb.objectStoreNames.contains('drafts') ? await guestDb.get('drafts', 'guest_draft') : undefined;
  let ls: LocalDraft | undefined;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT);
    if (raw) ls = JSON.parse(raw) as LocalDraft;
  } catch (e) {
    reportError(e, { action: 'readGuestDraft_ls' }, 'warning');
  }
  // S-55: черновик до 0.7.x нёс `timestamp`, не `updatedAt` — читаем оба, как GuestDraftService.
  const draft = ts(idb) >= ts(ls) ? (idb ?? ls) : ls;
  if (!draft) return null;
  if (ts(draft) > 1_000_000_000_000 && Date.now() - ts(draft) > GUEST_DRAFT_TTL_MS) return null;
  return draft;
}

/**
 * Re-keys this device's guest notes, versions, draft and profile onto a signed-in
 * account. Lives outside MigrationPrompt.tsx so the tests can run the real
 * thing: a copy of it in the test file drifted from production and kept
 * passing while the code it was meant to cover was wrong.
 */
export async function migrateDocuments(userId: string): Promise<MigrateResult> {
  const guestId = getOrCreateGuestId();
  const guestDb = await getLocalDb('justwriting-local');
  const userDb = await getLocalDb(userId);

  const hasDraftsInGuest = guestDb.objectStoreNames.contains('drafts');
  const hasDraftsInUser = userDb.objectStoreNames.contains('drafts');

  let draftMigrated = false;
  // S-63: черновик стал заметкой — считается в «перенесено» наравне с заметками.
  let draftNote = false;
  // D-3 / AG-MIG-1: migrate guest draft to user draft (don't clobber existing user draft).
  // S-44.4: черновик берётся из обоих хранилищ, не только из IndexedDB.
  const guestDraft = await readGuestDraft(guestDb);
  if (guestDraft && hasDraftsInUser) {
    const existingUserDraft = await userDb.get('drafts', userId);
    if (!existingUserDraft) {
      const newDraft = { ...guestDraft, userId };
      await userDb.put('drafts', newDraft);
      // Выгрузку делает слой письма по событию: прямой импорт из auth в
      // writing запрещён зонами import/no-restricted-paths.
      emitDomainEvent({ type: 'draft.migrated', userId });
      draftMigrated = true;
    } else if (guestDraft.content.trim() || guestDraft.title?.trim()) {
      // S-55: у аккаунта свой черновик — гостевой не затирается и не
      // выбрасывается, а становится обычной заметкой. Раньше он удалялся под
      // сообщением «перенесено 1». S-63: черновик только с названием — тоже
      // заметка; своё название черновика важнее «Черновик гостя, <дата>».
      await LocalStorageService.saveNew(userId, {
        title: guestDraft.title?.trim() || guestDraftNoteTitle(ts(guestDraft) || Date.now()),
        content: guestDraft.content,
        wordCount: guestDraft.wordCount ?? 0,
        duration: guestDraft.seconds ?? 0,
        wpm: guestDraft.wpm ?? 0,
        tags: [],
        sessionStartedAt: new Date(ts(guestDraft) || Date.now()),
        // Дата заметки — когда черновик писали, а не момент входа.
        documentDate: new Date(ts(guestDraft) || Date.now()),
      });
      draftMigrated = true;
      draftNote = true;
    }
    if (hasDraftsInGuest) {
      await guestDb.delete('drafts', 'guest_draft');
      if (userDb !== guestDb) {
        await guestDb.delete('drafts', userId);
      }
    }
    try { localStorage.removeItem(STORAGE_KEYS.GUEST_DRAFT); } catch { /* ignore */ }
  }

  // AG-MIG-1: migrate profile store if present
  let profileMigrated = false;
  if (guestDb.objectStoreNames.contains('profile') && userDb.objectStoreNames.contains('profile')) {
    const guestProfile = await guestDb.get('profile', guestId);
    if (guestProfile) {
      const existingUserProfile = await userDb.get('profile', userId);
      if (!existingUserProfile) {
        await userDb.put('profile', { ...guestProfile, guestId: userId });
        profileMigrated = true;
      }
      await guestDb.delete('profile', guestId);
      if (userDb !== guestDb) {
        await guestDb.delete('profile', userId);
      }
    }
  }

  // S-19: migrate guest streak freezes
  const guestFreezes = getFrozenDates(null);
  if (guestFreezes.size > 0) {
    const userFreezes = getFrozenDates(userId);
    const merged = new Set([...guestFreezes, ...userFreezes]);
    saveFrozenDates(merged, userId);
    clearFrozenDates(null);
  }

  // Migrate documents and versions
  const guestDocs = await guestDb.getAllFromIndex('documents', 'by-guest', guestId);
  if (guestDocs.length === 0) {
    // Миграция только черновика/профиля при 0 заметок — не «не смигрировано».
    const moved = (draftMigrated || profileMigrated) ? 1 : 0;
    return { moved, left: 0 };
  }

  let moved = 0;
  for (const doc of guestDocs) {
    try {
      const versions = await guestDb.getAllFromIndex('versions', 'by-document', doc.id);

      if (userDb !== guestDb) {
        const userTx = userDb.transaction(['documents', 'versions'], 'readwrite');
        await userTx.objectStore('documents').put({ ...doc, guestId: userId });
        for (const ver of versions) {
          await userTx.objectStore('versions').put({ ...ver, guestId: userId });
        }
        await userTx.done;

        // AG-5: Delete from guestDb ONLY after confirmed write in userDb
        const guestTx = guestDb.transaction(['documents', 'versions'], 'readwrite');
        await guestTx.objectStore('documents').delete(doc.id);
        for (const ver of versions) {
          await guestTx.objectStore('versions').delete(ver.id);
        }
        await guestTx.done;
      } else {
        // Re-key in guestDb (fallback if userDb is the same as guestDb)
        const guestTx = guestDb.transaction(['documents', 'versions'], 'readwrite');
        await guestTx.objectStore('documents').put({ ...doc, guestId: userId });
        for (const ver of versions) {
          await guestTx.objectStore('versions').put({ ...ver, guestId: userId });
        }
        await guestTx.done;
      }
      moved++;
    } catch (e) {
      reportError(e, { action: 'migrateDocuments_doc', docId: doc.id });
      break;
    }
  }

  const left = guestDocs.length - moved;
  return { moved: moved + (draftNote ? 1 : 0), left };
}
