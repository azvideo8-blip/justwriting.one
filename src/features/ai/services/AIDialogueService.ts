import { getLocalDb, randomUUID } from '../../../core/storage/localDb';
import type { AIDialogue } from '../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { AIChatMemoryService } from './AIChatMemoryService';

function formatDateYYYYMMDD(timestamp: number): string {
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function removeDialogueFromFacets(dialogueId: string): Promise<void> {
  try {
    const db = await getLocalDb();
    const facets = await db.getAll('aiProfileFacets');
    const tx = db.transaction('aiProfileFacets', 'readwrite');
    for (const f of facets) {
      if (f.dialogueIds && f.dialogueIds.includes(dialogueId)) {
        f.dialogueIds = f.dialogueIds.filter(id => id !== dialogueId);
        f.dirty = true;
        await tx.store.put(f);
      }
    }
    await tx.done;
  } catch (e) {
    console.warn('[AIDialogueService] removeDialogueFromFacets failed:', e);
  }
}


function currentLanguage(): 'ru' | 'en' {
  return localStorage.getItem(STORAGE_KEYS.APP_LANGUAGE) === 'en' ? 'en' : 'ru';
}

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

  async appendMessage(id: string, userMsg: string, assistantMsg: string, reasoning?: string): Promise<void> {
    const MAX_MSG_LENGTH = 100_000;
    const truncate = (s: string) => s.length > MAX_MSG_LENGTH ? s.slice(0, MAX_MSG_LENGTH) + '\n[...truncated]' : s;
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    const now = Date.now();
    existing.messages.push(
      { role: 'user', content: truncate(userMsg) },
      { role: 'assistant', content: truncate(assistantMsg), ...(reasoning ? { reasoning: truncate(reasoning) } : {}) },
    );
    existing.updatedAt = now;
    await tx.store.put(existing);
    await tx.done;
  },

  async deleteMessage(id: string, index: number): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    if (index < 0 || index >= existing.messages.length) { await tx.done; return; }
    existing.messages.splice(index, 1);
    existing.updatedAt = Date.now();
    await tx.store.put(existing);
    await tx.done;
    window.dispatchEvent(new Event('dialogue-updated'));
  },

  async setDocumentId(id: string, documentId: string): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing || existing.documentId === documentId) { await tx.done; return; }
    existing.documentId = documentId;
    existing.updatedAt = Date.now();
    await tx.store.put(existing);
    await tx.done;
  },

  async truncateFrom(id: string, fromIndex: number): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    if (fromIndex < 0 || fromIndex >= existing.messages.length) { await tx.done; return; }
    existing.messages.splice(fromIndex);
    existing.updatedAt = Date.now();
    await tx.store.put(existing);
    await tx.done;
    window.dispatchEvent(new Event('dialogue-updated'));
  },

  async setLastAssistantVariants(id: string, variants: string[], variantIndex: number): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    for (let i = existing.messages.length - 1; i >= 0; i--) {
      const m = existing.messages[i];
      if (m && m.role === 'assistant' && m.type !== 'system') {
        m.variants = variants;
        m.variantIndex = variantIndex;
        break;
      }
    }
    existing.updatedAt = Date.now();
    await tx.store.put(existing);
    await tx.done;
    window.dispatchEvent(new Event('dialogue-updated'));
  },

  async switchVariant(id: string, variantIndex: number): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    for (let i = existing.messages.length - 1; i >= 0; i--) {
      const m = existing.messages[i];
      if (m && m.role === 'assistant' && m.type !== 'system') {
        if (!m.variants || variantIndex < 0 || variantIndex >= m.variants.length) { await tx.done; return; }
        m.variantIndex = variantIndex;
        m.content = m.variants[variantIndex] ?? m.content;
        break;
      }
    }
    existing.updatedAt = Date.now();
    await tx.store.put(existing);
    await tx.done;
    window.dispatchEvent(new Event('dialogue-updated'));
  },

  async updateTitle(id: string, title: string): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    existing.title = title;
    existing.updatedAt = Date.now();
    await tx.store.put(existing);
    await tx.done;
    window.dispatchEvent(new Event('dialogue-updated'));
  },

  async archive(id: string): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    existing.archivedAt = Date.now();
    existing.updatedAt = Date.now();
    await tx.store.put(existing);
    await tx.done;

    void this.generateClosingSummary(id);
  },

  async generateClosingSummary(id: string): Promise<void> {
    try {
      const db = await getLocalDb();
      const dialogue = await db.get('aiDialogues', id);
      if (!dialogue) return;

      const chatMessages = dialogue.messages.filter(m => m.type !== 'system');
      if (chatMessages.length < 4) return;

      const last10 = chatMessages.slice(-10);
      const { AIService } = await import('./AIService');
      const response = await AIService.chat({
        personaId: 'custom',
        customSystemPrompt: 'Составь 1-2 предложения: о чём был этот диалог и к какому выводу пришли. Только факты, без оценок.',
        messages: last10.map(m => ({ role: m.role, content: m.content })),
      });

      if (response.ok && response.text) {
        const text = response.text.trim();
        const date = formatDateYYYYMMDD(Date.now());
        const month = date.slice(0, 7);

        // Embed BEFORE opening the IDB transaction — awaiting a network call
        // between IDB ops auto-closes the transaction (TransactionInactiveError
        // on the next put). Do all async non-IDB work first.
        let vector: number[] | undefined;
        if (localStorage.getItem('ff_dialogues_in_facets') === 'true') {
          try {
            const embResult = await AIService.embed({ content: text });
            if (embResult.ok && embResult.vectors[0]) {
              vector = embResult.vectors[0];
            }
          } catch (e) {
            console.warn('[AIDialogueService] Failed to embed closingSummary:', e);
          }
        }

        const tx = db.transaction(['aiDialogues', 'aiDialogueEvents'], 'readwrite');
        const existing = await tx.objectStore('aiDialogues').get(id);
        if (existing) {
          existing.closingSummary = text;
          await tx.objectStore('aiDialogues').put(existing);
        }

        const dialogueToUse = existing || dialogue;
        await tx.objectStore('aiDialogueEvents').put({
          dialogueId: id,
          date,
          month,
          personaId: dialogueToUse.personaId,
          personaName: dialogueToUse.personaName,
          summary: text,
          themes: [],
          ...(vector ? { vector } : {}),
        });

        await tx.done;
      }
    } catch (e) {
      console.warn('[AIDialogueService] generateClosingSummary failed:', e);
    }
  },

  async unarchive(id: string): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction(['aiDialogues', 'aiDialogueEvents'], 'readwrite');
    const existing = await tx.objectStore('aiDialogues').get(id);
    if (!existing) { await tx.done; return; }
    existing.archivedAt = undefined;
    existing.updatedAt = Date.now();
    await tx.objectStore('aiDialogues').put(existing);
    await tx.objectStore('aiDialogueEvents').delete(id);
    await tx.done;
  },

  async delete(id: string): Promise<void> {
    const db = await getLocalDb();

    try {
      await AIChatMemoryService.deleteByDialogue(id);
    } catch (e) {
      console.warn('[AIDialogueService] deleteByDialogue failed:', e);
    }

    try {
      const tx = db.transaction('aiDialogueEvents', 'readwrite');
      await tx.store.delete(id);
      await tx.done;
    } catch (e) {
      console.warn('[AIDialogueService] delete dialogue event failed:', e);
    }

    await removeDialogueFromFacets(id);

    await db.delete('aiDialogues', id);
  },

  async cleanupEmpty(excludeId?: string): Promise<number> {
    const all = await this.list({ includeArchived: false });
    const now = Date.now();
    const STALE_MS = 10 * 60 * 1000;
    let count = 0;
    for (const d of all) {
      if (d.id === excludeId) continue;
      const ts = d.updatedAt || d.createdAt;
      if (now - ts < STALE_MS) continue;
      const nonSystem = d.messages.filter(m => m.type !== 'system');
      const isEmpty = nonSystem.length === 0 || nonSystem.every(m => m.content.trim() === '');
      if (isEmpty) {
        await this.delete(d.id);
        count++;
      }
    }
    return count;
  },

  async updateResponseLength(id: string, responseLength: 'short' | 'standard' | 'detailed', reasoning?: boolean): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const dialogue = await tx.store.get(id);
    if (!dialogue) { await tx.done; return; }
    const lengthLabel = responseLength === 'short' ? 'кратко' : responseLength === 'detailed' ? 'объёмно' : 'стандартно';
    const reasoningLabel = reasoning ? ' + рассуждения' : '';
    dialogue.messages.push({
      role: 'assistant',
      content: `⚙️ [Смена объёма]: Теперь ${dialogue.personaName} ответит вам ${lengthLabel}${reasoningLabel}`,
      type: 'system',
    });
    dialogue.responseLength = responseLength;
    if (reasoning !== undefined) dialogue.reasoning = reasoning;
    dialogue.updatedAt = Date.now();
    await tx.store.put(dialogue);
    await tx.done;
    window.dispatchEvent(new Event('dialogue-updated'));
  },

  async setTemporalScope(id: string, scope: AIDialogue['temporalScope']): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const dialogue = await tx.store.get(id);
    if (!dialogue) { await tx.done; return; }
    dialogue.temporalScope = scope;
    dialogue.updatedAt = Date.now();
    await tx.store.put(dialogue);
    await tx.done;
    window.dispatchEvent(new Event('dialogue-updated'));
  },

  async exportAsMarkdown(id: string): Promise<string> {
    const db = await getLocalDb();
    const dialogue = await db.get('aiDialogues', id);
    if (!dialogue) return '';

    const lang = currentLanguage();
    const dateStr = new Date(dialogue.createdAt).toLocaleString();
    const docLine = dialogue.documentId
      ? `\n${lang === 'ru' ? 'Документ' : 'Document'}: ${dialogue.documentId}`
      : '';
    const header = lang === 'ru'
      ? `# Диалог с ${dialogue.personaName} ${dialogue.personaEmoji}\nДата: ${dateStr}${docLine}\n\n---\n\n`
      : `# Dialogue with ${dialogue.personaName} ${dialogue.personaEmoji}\nDate: ${dateStr}${docLine}\n\n---\n\n`;
    const userLabel = lang === 'ru' ? 'Пользователь' : 'User';

    const messages = dialogue.messages
      .filter(m => m.type !== 'system')
      .map(m =>
        m.role === 'user'
          ? `**${userLabel}:** ${m.content}`
          : `**${dialogue.personaName}:** ${m.content}`
      ).join('\n\n');

    return header + messages;
  },
};
