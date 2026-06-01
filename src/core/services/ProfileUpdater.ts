import { getLocalDb } from '../storage/localDb';
import { LocalDocumentService } from './LocalDocumentService';
import { reportError } from '../errors/reportError';

export const ProfileUpdater = {
  async updateLocalProfile(
    guestId: string,
    oldWords: number,
    newWords: number,
    oldDuration: number,
    newDuration: number,
    now: number
  ): Promise<void> {
    try {
      const profileDb = await getLocalDb();
      const profileTx = profileDb.transaction(['profile'], 'readwrite');
      const profStore = profileTx.objectStore('profile');
      const profile = await profStore.get(guestId);
      if (profile) {
        await profStore.put({
          ...profile,
          totalWords: profile.totalWords - oldWords + newWords,
          totalDuration: profile.totalDuration - oldDuration + newDuration,
          sessionsCount: profile.sessionsCount + 1,
          lastSessionAt: now,
        });
      }
      await profileTx.done;

      if (!profile) {
        await LocalDocumentService._updateProfile(guestId);
      }
    } catch (profileErr) {
      reportError(profileErr, { action: 'updateLocalProfile', guestId });
      try {
        await LocalDocumentService._updateProfile(guestId);
      } catch (fallbackErr) {
        reportError(fallbackErr, { action: 'updateLocalProfile_fallback', guestId });
      }
    }
  },
};
