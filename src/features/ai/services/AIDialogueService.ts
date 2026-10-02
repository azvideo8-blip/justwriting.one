import { getLocalDb, randomUUID } from '../../../core/storage/localDb';
import { SYSTEM_TASK_PROMPTS } from '../../../shared/ai/systemTaskPrompts';
import type { AIDialogue, DialogueMessage } from '../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { AIChatMemoryService } from './AIChatMemoryService';
import { LocalStoreSyncService } from '../../../core/services/LocalStoreSyncService';
import { getCurrentUser } from '../../../core/auth';
import { hasIndexingConsent } from '../../../core/ai/indexingConsent';
import { isTombstoned, stampMessage, tombstoneDialogue, withMessageIds } from '../../../core/storage/dialogueMerge';
import { toApiContent } from '../utils/aiChatTransport';

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
    // S-36: ответ помнит id своего вопроса и создан на тик позже него (порядок
    // хвоста при слиянии — по ходам, ход ответа — createdAt − 1 и turnId).
    let turnId: string | undefined;
    const dialogue: AIDialogue = {
      ...data,
      messages: data.messages.map((m, i) => {
        const stamped = stampMessage(m, now + i);
        if (m.role === 'user' && m.type !== 'system') { turnId = stamped.id; return stamped; }
        return m.role === 'assistant' && m.type !== 'system' && turnId ? { ...stamped, turnId } : stamped;
      }),
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
    return found && !found.deletedAt ? withMessageIds(found) : undefined;
  },

  async list(options?: { includeArchived?: boolean }): Promise<AIDialogue[]> {
    const db = await getLocalDb();
    const now = Date.now();
    const live: AIDialogue[] = [];
    for (const d of await db.getAll('aiDialogues')) {
      if (d.deletedAt) {
        // S-58: надгробие старше срока снимается — здесь и в облаке.
        if (!isTombstoned(d, now)) {
          await db.delete('aiDialogues', d.id);
          LocalStoreSyncService.scheduleStoreDelete('aiDialogues', d.id);
        }
        continue;
      }
      live.push(withMessageIds(d));
    }
    const filtered = options?.includeArchived
      ? live
      : live.filter(d => !d.archivedAt);
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async listByDocument(documentId: string): Promise<AIDialogue[]> {
    const db = await getLocalDb();
    const all = (await db.getAllFromIndex('aiDialogues', 'by-document', documentId)).filter(d => !d.deletedAt).map(withMessageIds);
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
    // S-58: ответ, пришедший после удаления диалога, в надгробие не дописывается.
    if (!existing || existing.deletedAt) { await tx.done; return; }
    const now = Date.now();
    // Ответ создаётся после вопроса: с одним `createdAt` слияние рассортирует
    // реплики по id, и ответ встанет перед своим вопросом.
    const question = stampMessage({ role: 'user', content: truncate(userMsg) }, now);
    existing.messages.push(
      question,
      stampMessage({
        role: 'assistant',
        content: truncate(assistantMsg),
        turnId: question.id,
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
   * S-25 / S-29 / S-36: перегенерация хода по id его пользовательской реплики.
   * Ход остаётся на месте и с теми же id: вопрос как был, у ответа новый
   * текст, прежний уходит в варианты (союз), ответ помечен updatedAt, чтобы при
   * слиянии победила более свежая копия. Прежний путь «вырезать и дописать с
   * новыми id» давал два вопроса при перегенерации на двух устройствах, а после
   * служебной реплики (смена объёма/персоны) — второй вопрос в конце. Нет
   * такого вопроса (удалён на другом устройстве) — ход дописывается в конец,
   * а не режет чужое.
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
    if (!existing || existing.deletedAt) { await tx.done; return; }
    // Id старых реплик проставляем в саму запись: править надо то, что пойдёт в
    // базу, а не копию рядом с ней.
    existing.messages = withMessageIds(existing).messages;
    const now = Date.now();
    const answer: DialogueMessage = {
      role: 'assistant',
      content: truncate(assistantMsg),
      turnId: replaceUserId,
      ...(reasoning ? { reasoning: truncate(reasoning) } : {}),
      ...(searchRequest ? { searchRequest: truncate(searchRequest) } : {}),
      ...(degradedReason ? { degradedReason } : {}),
    };
    const userIdx = existing.messages.findIndex(m => m.id === replaceUserId);
    // Ответ хода — первая реплика ассистента после вопроса; служебные
    // пропускаем, на следующем вопросе останавливаемся (ответ удалён).
    let answerIdx = -1;
    for (let i = userIdx + 1; userIdx >= 0 && i < existing.messages.length; i++) {
      const m = existing.messages[i]!;
      if (m.type === 'system') continue;
      if (m.role === 'assistant') answerIdx = i;
      break;
    }
    if (userIdx < 0) {
      // Ответ создаётся после вопроса: с одним `createdAt` слияние рассортирует
      // реплики по id, и ответ встанет перед своим вопросом.
      const question = stampMessage({ role: 'user', content: truncate(userMsg) }, now);
      existing.messages.push(question, stampMessage({ ...answer, turnId: question.id }, now + 1));
    } else if (answerIdx < 0) {
      existing.messages.splice(userIdx + 1, 0, stampMessage(answer, (existing.messages[userIdx]!.createdAt ?? now) + 1));
    } else {
      const old = existing.messages[answerIdx]!;
      const variants = [...(old.variants ?? []), old.content, answer.content].filter((v, i, arr) => arr.indexOf(v) === i);
      existing.messages[answerIdx] = { ...answer, id: old.id, createdAt: old.createdAt, variants, variantIndex: variants.indexOf(answer.content), updatedAt: now };
    }
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
      existing.deletedMessages = [...(existing.deletedMessages ?? []), { id: removed.id, at: Date.now() }];
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

  /**
   * S-36/S-57: смена варианта — у реплики по её id, а не у «последнего ответа»:
   * на отставшем экране последний ответ — чужой ход с другого устройства.
   */
  async switchVariant(id: string, messageId: string, variantIndex: number): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    // S-36: id в запись до правки на месте — позиционный id старой реплики
    // считался по тексту, и смена текста меняла id: слияние видело две реплики.
    existing.messages = withMessageIds(existing).messages;
    const m = existing.messages.find(x => x.id === messageId);
    if (!m || m.role !== 'assistant' || m.type === 'system' || !m.variants || variantIndex < 0 || variantIndex >= m.variants.length) {
      await tx.done;
      return;
    }
    m.variantIndex = variantIndex;
    m.content = m.variants[variantIndex] ?? m.content;
    m.updatedAt = Date.now();
    existing.updatedAt = Date.now();
    await tx.store.put(existing);
    await tx.done;
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
    window.dispatchEvent(new Event('dialogue-updated'));
  },

  /**
   * S-57: смена персоны — одной транзакцией и с постановкой в выгрузку. Прежний
   * писатель в useAIChat делал get и put врозь (ход, записанный между ними,
   * терялся) и в облако запись не ставил.
   */
  async setPersona(id: string, persona: { personaId: string; personaName: string; personaEmoji: string }): Promise<AIDialogue | undefined> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return undefined; }
    const fresh = withMessageIds(existing);
    fresh.personaId = persona.personaId;
    fresh.personaName = persona.personaName;
    fresh.personaEmoji = persona.personaEmoji;
    fresh.messages.push(stampMessage({
      role: 'assistant',
      content: `⚙️ [Смена персоны]: Теперь с вами общается ${persona.personaName}`,
      type: 'system',
    }));
    fresh.updatedAt = Date.now();
    await tx.store.put(fresh);
    await tx.done;
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
    return fresh;
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
      if (!dialogue || dialogue.deletedAt) return;

      const chatMessages = dialogue.messages.filter(m => m.type !== 'system');
      if (chatMessages.length < 4) return;

      const last10 = chatMessages.slice(-10);
      const { AIService } = await import('./AIService');
      const response = await AIService.chat({
        personaId: 'custom',
        callType: 'system_task',
        customSystemPrompt: SYSTEM_TASK_PROMPTS.dialogueSummary,
        // S-51: тело приложенной заметки в модель не идёт — те же правила, что у истории чата.
        messages: last10.map(m => ({ role: m.role, content: toApiContent(m.content) })),
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
        // S-58: диалог удалён, пока модель отвечала, — итог и событие не пишутся.
        if (!existing || existing.deletedAt) {
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

    // S-58: не стирание строки, а надгробие — иначе устройство, ещё державшее
    // диалог, дописывало ход и возвращало его в облако (сценарий 15 стенда).
    // Удаление побеждает при слиянии; через TOMBSTONE_TTL_MS list() снимает запись.
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (existing) await tx.store.put(tombstoneDialogue(existing, Date.now()));
    await tx.done;
    if (existing) LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
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
