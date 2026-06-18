import { getLocalDb, randomUUID } from '../../../core/storage/localDb';
import type { AIDialogue } from '../../../core/storage/localDb';

export const AIDialogueService = {
  async create(data: Omit<AIDialogue, 'id' | 'createdAt' | 'updatedAt'>): Promise<AIDialogue> {
    const db = await getLocalDb();
    const now = Date.now();
    const dialogue: AIDialogue = {
      ...data,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await db.put('aiDialogues', dialogue);
    return dialogue;
  },

  async get(id: string): Promise<AIDialogue | undefined> {
    const db = await getLocalDb();
    return db.get('aiDialogues', id) ?? undefined;
  },

  async list(options?: { includeArchived?: boolean }): Promise<AIDialogue[]> {
    const db = await getLocalDb();
    const all = await db.getAll('aiDialogues');
    const filtered = options?.includeArchived
      ? all
      : all.filter(d => !d.archivedAt);
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async listByDocument(documentId: string): Promise<AIDialogue[]> {
    const db = await getLocalDb();
    const all = await db.getAllFromIndex('aiDialogues', 'by-document', documentId);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async appendMessage(id: string, userMsg: string, assistantMsg: string): Promise<void> {
    const MAX_MSG_LENGTH = 100_000;
    const truncate = (s: string) => s.length > MAX_MSG_LENGTH ? s.slice(0, MAX_MSG_LENGTH) + '\n[...truncated]' : s;
    const db = await getLocalDb();
    const existing = await db.get('aiDialogues', id);
    if (!existing) return;
    const now = Date.now();
    existing.messages.push(
      { role: 'user', content: truncate(userMsg) },
      { role: 'assistant', content: truncate(assistantMsg) },
    );
    existing.updatedAt = now;
    await db.put('aiDialogues', existing);
  },

  async updateTitle(id: string, title: string): Promise<void> {
    const db = await getLocalDb();
    const existing = await db.get('aiDialogues', id);
    if (!existing) return;
    existing.title = title;
    existing.updatedAt = Date.now();
    await db.put('aiDialogues', existing);
  },

  async archive(id: string): Promise<void> {
    const db = await getLocalDb();
    const existing = await db.get('aiDialogues', id);
    if (!existing) return;
    existing.archivedAt = Date.now();
    existing.updatedAt = Date.now();
    await db.put('aiDialogues', existing);
  },

  async delete(id: string): Promise<void> {
    const db = await getLocalDb();
    await db.delete('aiDialogues', id);
  },

  async updateResponseLength(id: string, responseLength: 'short' | 'standard' | 'detailed'): Promise<void> {
    const db = await getLocalDb();
    const dialogue = await db.get('aiDialogues', id);
    if (!dialogue) return;
    await db.put('aiDialogues', { ...dialogue, responseLength, updatedAt: Date.now() });
  },

  async exportAsMarkdown(id: string): Promise<string> {
    const db = await getLocalDb();
    const dialogue = await db.get('aiDialogues', id);
    if (!dialogue) return '';

    const dateStr = new Date(dialogue.createdAt).toLocaleString();
    const docLine = dialogue.documentId ? `\nDocument: ${dialogue.documentId}` : '';
    const header = `# Dialogue with ${dialogue.personaName} ${dialogue.personaEmoji}\nDate: ${dateStr}${docLine}\n\n---\n\n`;

    const messages = dialogue.messages.map(m =>
      m.role === 'user'
        ? `**You:** ${m.content}`
        : `**${dialogue.personaName}:** ${m.content}`
    ).join('\n\n');

    return header + messages;
  },
};
