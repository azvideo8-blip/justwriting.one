import { getLocalDb } from '../../../core/storage/localDb';
import { countUnsyncedLocalData } from './unsyncedLocalData';

export interface LocalDataInventory {
  notesCount: number;
  versionsCount: number;
  hasPortrait: boolean;
  facetsCount: number;
  dialoguesCount: number;
  dialogueEventsCount: number;
  chatMemoriesCount: number;
  lifeStoryCount: number;
  themeCount: number;
  beliefsCount: number;
  commitmentsCount: number;
  digestsCount: number;
  threadsCount: number;
  personasCount: number;
  unsyncedNotesCount: number;
  totalItems: number;
}

export async function countLocalDataInventory(userId?: string): Promise<LocalDataInventory> {
  const db = await getLocalDb(userId);

  let notesCount = 0;
  let versionsCount = 0;

  try {
    if (userId) {
      const docIds = await db.getAllKeysFromIndex('documents', 'by-guest', userId);
      notesCount = docIds.length;
      const counts = await Promise.all(docIds.map(docId => db.countFromIndex('versions', 'by-document', String(docId))));
      versionsCount = counts.reduce((sum, c) => sum + c, 0);
    } else {
      notesCount = await db.count('documents');
      versionsCount = await db.count('versions');
    }
  } catch {
    /* fallback to 0 */
  }

  let hasPortrait = false;
  try {
    const portrait = await db.get('aiPortrait', 'singleton');
    hasPortrait = Boolean(portrait?.portrait || localStorage.getItem(`ai_user_portrait_${userId ?? ''}`));
  } catch {
    hasPortrait = Boolean(localStorage.getItem(`ai_user_portrait_${userId ?? ''}`));
  }

  const safeCount = async (storeName: Parameters<typeof db.count>[0]): Promise<number> => {
    try {
      if (!db.objectStoreNames.contains(storeName)) return 0;
      return await db.count(storeName);
    } catch {
      return 0;
    }
  };

  const [
    facetsCount,
    dialoguesCount,
    dialogueEventsCount,
    chatMemoriesCount,
    lifeStoryCount,
    themeCount,
    beliefsCount,
    commitmentsCount,
    digestsCount,
    threadsCount,
    personasCount,
  ] = await Promise.all([
    safeCount('aiProfileFacets'),
    safeCount('aiDialogues'),
    safeCount('aiDialogueEvents'),
    safeCount('aiChatMemory'),
    safeCount('lifeStory'),
    safeCount('aiThemeLedger'),
    safeCount('aiBeliefs'),
    safeCount('aiCommitments'),
    safeCount('aiMonthlyDigest'),
    safeCount('aiThreads'),
    safeCount('aiPersonas'),
  ]);

  let unsyncedNotesCount = 0;
  try {
    const unsynced = await countUnsyncedLocalData(userId);
    unsyncedNotesCount = unsynced.total;
  } catch {
    /* ignore */
  }

  const totalItems =
    notesCount +
    versionsCount +
    (hasPortrait ? 1 : 0) +
    facetsCount +
    dialoguesCount +
    dialogueEventsCount +
    chatMemoriesCount +
    lifeStoryCount +
    themeCount +
    beliefsCount +
    commitmentsCount +
    digestsCount +
    threadsCount +
    personasCount;

  return {
    notesCount,
    versionsCount,
    hasPortrait,
    facetsCount,
    dialoguesCount,
    dialogueEventsCount,
    chatMemoriesCount,
    lifeStoryCount,
    themeCount,
    beliefsCount,
    commitmentsCount,
    digestsCount,
    threadsCount,
    personasCount,
    unsyncedNotesCount,
    totalItems,
  };
}

export async function hasOtherUserData(currentUserId: string): Promise<boolean> {
  try {
    const db = await getLocalDb();
    const allDocs = await db.getAll('documents');
    return allDocs.some(d => Boolean(d.guestId) && d.guestId !== currentUserId && d.guestId !== 'guest');
  } catch {
    return false;
  }
}

export async function clearOtherUserData(currentUserId: string): Promise<{ deletedDocs: number }> {
  const db = await getLocalDb();
  const allDocs = await db.getAll('documents');
  const otherDocs = allDocs.filter(d => Boolean(d.guestId) && d.guestId !== currentUserId && d.guestId !== 'guest');

  const tx = db.transaction(['documents', 'versions', 'drafts', 'profile'], 'readwrite');
  for (const doc of otherDocs) {
    await tx.objectStore('documents').delete(doc.id);
    const vers = await tx.objectStore('versions').index('by-document').getAllKeys(doc.id);
    for (const vKey of vers) {
      await tx.objectStore('versions').delete(vKey);
    }
  }
  await tx.done;

  return { deletedDocs: otherDocs.length };
}
