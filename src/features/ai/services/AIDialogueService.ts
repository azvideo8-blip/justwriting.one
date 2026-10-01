import { getLocalDb, randomUUID } from '../../../core/storage/localDb';
import { SYSTEM_TASK_PROMPTS } from '../../../shared/ai/systemTaskPrompts';
import type { AIDialogue } from '../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { AIChatMemoryService } from './AIChatMemoryService';
import { LocalStoreSyncService } from '../../../core/services/LocalStoreSyncService';
import { getCurrentUser } from '../../../core/auth';
import { hasIndexingConsent } from '../../../core/ai/indexingConsent';
import { stampMessage, withMessageIds } from '../utils/dialogueMerge';

import { writeFacetStore } from '../../../core/services/facetLock';

function formatDateYYYYMMDD(timestamp: number): string {
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const MAX_MSG_LENGTH = 100_000;

async function removeDialogueFromFacets(dialogueId: string): Promise<void> {
  await writeFacetStore(async (store) => {
    try {
      const facets = await store.getAll();
      const tx = store.transaction();
      for (const f of facets) {
        if (f.dialogueIds && f.dialogueIds.includes(dialogueId)) {
          f.dialogueIds = f.dialogueIds.filter(id => id !== dialogueId);
          f.dirty = true;
          await tx.store.put(f);
          LocalStoreSyncService.scheduleStoreSync('aiProfileFacets', f.id);
        }
      }
      await tx.done;
    } catch (e) {
      console.warn('[AIDialogueService] removeDialogueFromFacets failed:', e);
    }
  });
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
      messages: data.messages.map(m => stampMessage(m, now)),
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await db.put('aiDialogues', dialogue);
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', dialogue.id);
    return dialogue;
  },

  async get(id: string): Promise<AIDialogue | undefined> {
    if (!id || typeof id !== 'string') return undefined;
    const db = await getLocalDb();
    const found = await db.get('aiDialogues', id);
    return found ? withMessageIds(found) : undefined;
  },

  async list(options?: { includeArchived?: boolean }): Promise<AIDialogue[]> {
    const db = await getLocalDb();
    const all = (await db.getAll('aiDialogues')).map(withMessageIds);
    const filtered = options?.includeArchived
      ? all
      : all.filter(d => !d.archivedAt);
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async listByDocument(documentId: string): Promise<AIDialogue[]> {
    const db = await getLocalDb();
    const all = (await db.getAllFromIndex('aiDialogues', 'by-document', documentId)).map(withMessageIds);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async appendMessage(
    id: string,
    userMsg: string,
    assistantMsg: string,
    reasoning?: string,
    searchRequest?: string | null,
    degradedReason?: string | null
  ): Promise<void> {
    const truncate = (s: string) => s.length > MAX_MSG_LENGTH ? s.slice(0, MAX_MSG_LENGTH) + '\n[...truncated]' : s;
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    const now = Date.now();
    // Ответ создаётся после вопроса: с одним `createdAt` слияние рассортирует
    // реплики по id, и ответ встанет перед своим вопросом.
    existing.messages.push(
      stampMessage({ role: 'user', content: truncate(userMsg) }, now),
      stampMessage({
        role: 'assistant',
        content: truncate(assistantMsg),
        ...(reasoning ? { reasoning: truncate(reasoning) } : {}),
        ...(searchRequest ? { searchRequest: truncate(searchRequest) } : {}),
        ...(degradedReason ? { degradedReason } : {}),
      }, now + 1),
    );
    existing.updatedAt = now;
    await tx.store.put(existing);
    await tx.done;
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
  },

  /**
   * S-25 / S-29: замена последнего хода по id его пользовательской реплики, а не
   * по позиции. Прежний `fromIndex` приходил из состояния вкладки и срезал
   * `splice(fromIndex)` чужой ход, если соседняя вкладка успела дописать. Теперь:
   * если заменяемого хода уже нет в конце — дописываем, а не урезаем; убранные
   * реплики остаются в списке удалённых, чтобы слияние не вернуло их из второй
   * реплики.
   */
  async replaceLastTurn(
    id: string,
    replaceUserId: string,
    userMsg: string,
    assistantMsg: string,
    reasoning?: string,
    searchRequest?: string | null,
    degradedReason?: string | null,
  ): Promise<void> {
    const truncate = (s: string) => s.length > MAX_MSG_LENGTH ? s.slice(0, MAX_MSG_LENGTH) + '\n[...truncated]' : s;
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    // Id старых реплик проставляем в саму запись: резать надо то, что пойдёт в
    // базу, а не копию рядом с ней.
    existing.messages = withMessageIds(existing).messages;
    const idx = existing.messages.findIndex(m => m.id === replaceUserId);
    const isLastTurn = idx >= 0 && idx === existing.messages.length - 2;
    if (isLastTurn) {
      const removed = existing.messages.splice(idx);
      existing.deletedMessageIds = [...(existing.deletedMessageIds ?? []), ...removed.map(m => m.id!).filter(Boolean)];
    }
    const now = Date.now();
    // Ответ создаётся после вопроса: с одним `createdAt` слияние рассортирует
    // реплики по id, и ответ встанет перед своим вопросом.
    existing.messages.push(
      stampMessage({ role: 'user', content: truncate(userMsg) }, now),
      stampMessage({
        role: 'assistant',
        content: truncate(assistantMsg),
        ...(reasoning ? { reasoning: truncate(reasoning) } : {}),
        ...(searchRequest ? { searchRequest: truncate(searchRequest) } : {}),
        ...(degradedReason ? { degradedReason } : {}),
      }, now + 1),
    );
    existing.updatedAt = now;
    await tx.store.put(existing);
    await tx.done;
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
  },

  async deleteMessage(id: string, messageId: string): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    existing.messages = withMessageIds(existing).messages;
    const idx = existing.messages.findIndex(m => m.id === messageId);
    if (idx < 0) { await tx.done; return; }
    const removed = existing.messages.splice(idx, 1)[0];
    if (removed?.id) {
      existing.deletedMessageIds = [...(existing.deletedMessageIds ?? []), removed.id];
    }
    existing.updatedAt = Date.now();
    await tx.store.put(existing);
    await tx.done;
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
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
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
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
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
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
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
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
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
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
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);

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
        callType: 'system_task',
        customSystemPrompt: SYSTEM_TASK_PROMPTS.dialogueSummary,
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
        const uid = getCurrentUser()?.uid;
        if (localStorage.getItem('ff_dialogues_in_facets') === 'true' && hasIndexingConsent(uid)) {
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
        if (!existing) {
          try {
            tx.abort();
            await tx.done.catch(() => {});
          } catch { /* ignore */ }
          return;
        }

        existing.closingSummary = text;
        // S-35: без новой отметки инкрементальный забор на другом устройстве
        // итог не увидит.
        existing.updatedAt = Date.now();
        await tx.objectStore('aiDialogues').put(existing);

        await tx.objectStore('aiDialogueEvents').put({
          dialogueId: id,
          date,
          month,
          personaId: existing.personaId,
          personaName: existing.personaName,
          summary: text,
          themes: [],
          ...(vector ? { vector } : {}),
        });

        await tx.done;
        LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
        LocalStoreSyncService.scheduleStoreSync('aiDialogueEvents', id);
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
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
    LocalStoreSyncService.scheduleStoreDelete('aiDialogueEvents', id);
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
    LocalStoreSyncService.scheduleStoreDelete('aiDialogues', id);
    LocalStoreSyncService.scheduleStoreDelete('aiDialogueEvents', id);
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
    dialogue.messages.push(stampMessage({
      role: 'assistant',
      content: `⚙️ [Смена объёма]: Теперь ${dialogue.personaName} ответит вам ${lengthLabel}${reasoningLabel}`,
      type: 'system',
    }));
    dialogue.responseLength = responseLength;
    if (reasoning !== undefined) dialogue.reasoning = reasoning;
    dialogue.updatedAt = Date.now();
    await tx.store.put(dialogue);
    await tx.done;
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
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
