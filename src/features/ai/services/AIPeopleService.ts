import { getLocalDb, type AIPeopleIndexEntry } from '../../../core/storage/localDb';

export const AIPeopleService = {
  async getAll(): Promise<AIPeopleIndexEntry[]> {
    const db = await getLocalDb();
    const all = await db.getAll('aiPeopleIndex');
    return all.sort((a, b) => b.mentionCount - a.mentionCount);
  },

  async search(name: string): Promise<AIPeopleIndexEntry[]> {
    const query = name.trim().toLowerCase();
    if (!query) return [];
    const db = await getLocalDb();
    const all = await db.getAll('aiPeopleIndex');
    return all
      .filter(p => p.key.includes(query) || query.includes(p.key))
      .sort((a, b) => b.mentionCount - a.mentionCount);
  },

  async getForNote(documentId: string): Promise<AIPeopleIndexEntry[]> {
    const db = await getLocalDb();
    const all = await db.getAll('aiPeopleIndex');
    return all
      .filter(p => p.noteIds.includes(documentId))
      .sort((a, b) => b.mentionCount - a.mentionCount);
  },
};
