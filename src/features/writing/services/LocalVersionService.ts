import { getLocalDb, LocalVersion } from '../../../shared/lib/localDb';
import { computeWordDiff } from './DiffService';

export const LocalVersionService = {
  async addVersion(
    guestId: string,
    documentId: string,
    data: {
      content: string;
      previousContent: string;
      wordCount: number;
      duration: number;
      wpm: number;
      versionNumber: number;
      goalWords?: number;
      goalTime?: number;
      goalReached?: boolean;
      sessionStartedAt: Date;
    }
  ): Promise<string> {
    const db = await getLocalDb();
    const id = `ver_${crypto.randomUUID()}`;
    const diff = computeWordDiff(data.previousContent, data.content);

    await db.put('versions', {
      id,
      documentId,
      guestId,
      version: data.versionNumber,
      content: data.content,
      wordCount: data.wordCount,
      wordsAdded: diff.wordsAdded,
      charsAdded: diff.charsAdded,
      duration: data.duration,
      wpm: data.wpm,
      goalWords: data.goalWords,
      goalTime: data.goalTime,
      goalReached: data.goalReached ?? false,
      savedAt: Date.now(),
      sessionStartedAt: data.sessionStartedAt.getTime(),
    });

    return id;
  },

  async getVersions(documentId: string): Promise<LocalVersion[]> {
    const db = await getLocalDb();
    const all = await db.getAllFromIndex('versions', 'by-document', documentId);
    return all.sort((a, b) => a.version - b.version);
  },

  async getLatestContent(documentId: string): Promise<string> {
    const versions = await LocalVersionService.getVersions(documentId);
    return versions[versions.length - 1]?.content ?? '';
  },
};
