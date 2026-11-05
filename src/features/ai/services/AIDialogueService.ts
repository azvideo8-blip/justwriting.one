import { carryCloudSyncFields, getLocalDb, randomUUID } from '../../../core/storage/localDb';
import { SYSTEM_TASK_PROMPTS } from '../../../shared/ai/systemTaskPrompts';
import type { AIDialogue, DialogueMessage } from '../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { AIChatMemoryService } from './AIChatMemoryService';
import { LocalStoreSyncService } from '../../../core/services/LocalStoreSyncService';
import { getCurrentUser } from '../../../core/auth';
import { hasIndexingConsent } from '../../../core/ai/indexingConsent';
import { isTombstoned, stampMessage, tombstoneDialogue, withMessageIds } from '../../../core/storage/dialogueMerge';
import { toApiContent, legacyNoteHidden, citesAnyId, HIDDEN_ANSWER_PLACEHOLDER } from '../utils/aiChatTransport';
import { hiddenNoteIdsFromDocs } from '../utils/hiddenNoteIds';
import { isExcludedFromAI, isPastedAttachmentId } from '../utils/isExcludedFromAI';

import { writeFacetStore } from '../../../core/services/facetLock';
import { truncateText } from '../../../shared/utils/textLimits';

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

// DR-7: экспорт диалога — единственный способ разобрать ход перечитать. Из него
// выпадали две вещи: текст приложенной заметки (ход хранит маркер и вопрос, тело
// едет отдельным блоком) и «ход мыслей» ответа (живёт в msg.reasoning). Текст
// берётся ТЕКУЩИЙ из локального хранилища — заметку могли поправить после хода;
// наружу при этом ничего не уходит.
const ATTACHED_HEAD_ID = /\[#([^\]\s·]+) · /g;
const ATTACHED_MARKER = '[Прикреплена заметка: "';

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;

async function latestVersionContent(db: LocalDb, documentId: string): Promise<string | null> {
  const versions = await db.getAllFromIndex('versions', 'by-document', documentId);
  if (versions.length === 0) return null;
  versions.sort((a, b) => b.version - a.version);
  return versions[0]?.content ?? null;
}

/** Цитата под маркером заметки: её текущий текст либо заглушка, если её нет в открытом доступе ИИ. */
async function attachedNoteAppendix(
  content: string,
  documentId: string | undefined,
  db: LocalDb,
  hiddenLabel: string,
): Promise<string> {
  if (!content.includes(ATTACHED_MARKER)) return '';
  const usable = (id: string) => !isPastedAttachmentId(id);
  const ids = [...new Set([...content.matchAll(ATTACHED_HEAD_ID)].map(m => m[1]!).filter(usable))];
  // Старый ход без шапки `[#id · дата]`: заметка диалога — единственный адрес.
  if (ids.length === 0 && documentId && usable(documentId)) ids.push(documentId);
  const blocks: string[] = [];
  for (const id of ids) {
    const doc = await db.get('documents', id);
    const text = await latestVersionContent(db, id);
    // Короткое тело стоит в ходу дословно (useAIPageData, `inline`): не дублируем.
    const inTurn = text !== null && content.includes(text);
    // Скрытая от ИИ, в корзине или удалённая заметка текстом не делится.
    if (isExcludedFromAI(doc)) {
      // R7F-012: если то же тело уже лежит в самой реплике (заметку скрыли
      // ПОСЛЕ хода), плашка «текст заметки не выгружен» врёт про собственный
      // экспорт: читатель видит и тело, и отрицание. Вырезать текст из
      // человеческой реплики — портить дневник, поэтому правдивой делает
      // именно плашку: без неё тело остаётся там, где его написал автор.
      if (inTurn) continue;
      blocks.push(`> ${hiddenLabel}`);
      continue;
    }
    if (!text || inTurn) continue;
    blocks.push(text.split('\n').map(line => `> ${line}`).join('\n'));
  }
  return blocks.length > 0 ? `\n\n${blocks.join('\n\n')}` : '';
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
    degradedReason?: string | null,
    contextDocIds?: string[] | null,
    notesClaimNoRef?: boolean | null,
  ): Promise<void> {
    const truncate = (s: string) => s.length > MAX_MSG_LENGTH ? truncateText(s, MAX_MSG_LENGTH, { maxCodeUnits: MAX_MSG_LENGTH }) + '\n[...truncated]' : s;
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
        // DT-3 (дейлик 04.11): пустой список — записанное решение («материалы
        // скрыли»), а не «клиент про поле не знает»: иначе слияние (dialogueMerge.ts:141)
        // вернёт id скрытой заметки из старой копии и синк унесёт его в облако.
        ...(contextDocIds ? { contextDocIds } : {}),
        ...(notesClaimNoRef ? { notesClaimNoRef: true } : {}),
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
    contextDocIds?: string[] | null,
    notesClaimNoRef?: boolean | null,
  ): Promise<void> {
    const truncate = (s: string) => s.length > MAX_MSG_LENGTH ? truncateText(s, MAX_MSG_LENGTH, { maxCodeUnits: MAX_MSG_LENGTH }) + '\n[...truncated]' : s;
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
      // DT-3: тот же смысл, что в appendMessage, — пустой список пишется явно.
      ...(contextDocIds ? { contextDocIds } : {}),
      ...(notesClaimNoRef ? { notesClaimNoRef: true } : {}),
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
   * A9 (FN-2б): служебная строка в диалоге — например, что строгий ход обрезан.
   * Одной транзакцией, надгробие не трогаем; в API такие строки не уходят
   * (`type: 'system'` отфильтрован в prepareApiMessages).
   */
  async appendSystemMessage(id: string, content: string, opts?: { once?: boolean }): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing || existing.deletedAt) { await tx.done; return; }
    // C9: `once` — та же системная строка в диалоге уже есть (приложенная заметка
    // висит на каждом ходе, повтор хода) — вторую не пишем.
    if (opts?.once && existing.messages.some(m => m.type === 'system' && m.content === content)) { await tx.done; return; }
    const fresh = withMessageIds(existing);
    fresh.messages.push(stampMessage({ role: 'assistant', content, type: 'system' }));
    fresh.updatedAt = Date.now();
    await tx.store.put(fresh);
    await tx.done;
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
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
    // M-4: диалог удалён (надгробие) — персона сюда не пишется, иначе запись
    // оживала без единого хода и уходила в облако как живая.
    if (!existing || existing.deletedAt) { await tx.done; return undefined; }
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
    // M-4: надгробие не переименовываем (см. setPersona).
    if (!existing || existing.deletedAt) { await tx.done; return; }
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
      const legacyParse = { legacyNoteHidden: await legacyNoteHidden(dialogue, db) };
      // AP-2: итог не пересказывает скрытую заметку — ответ с её цитатой
      // уходит в модель заглушкой, как и в истории чата.
      const hiddenIds = hiddenNoteIdsFromDocs(await db.getAll('documents'));
      const { AIService } = await import('./AIService');
      const response = await AIService.chat({
        personaId: 'custom',
        callType: 'system_task',
        customSystemPrompt: SYSTEM_TASK_PROMPTS.dialogueSummary,
        // S-51: тело приложенной заметки в модель не идёт — те же правила, что у истории чата.
        messages: last10.map(m => ({
          role: m.role,
          content: m.role === 'assistant' && citesAnyId(m.content, hiddenIds)
            ? HIDDEN_ANSWER_PLACEHOLDER
            : toApiContent(m.content, undefined, { ...legacyParse, hiddenCitationIds: hiddenIds }),
        })),
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

        // SF2-5: строка события собирается заново и в собственной транзакции —
        // обёртка `db.put` её не видит, поэтому серверную отметку и хэша переносим
        // явно. Без них запись остаётся «без базы», и следующая выгрузка берёт
        // ТЕКУЩИЙ штамп облака своей базой (класс F-1).
        const eventStore = tx.objectStore('aiDialogueEvents');
        const previousEvent = await eventStore.get(id) as Record<string, unknown> | undefined;
        await eventStore.put(carryCloudSyncFields({
          dialogueId: id,
          date,
          month,
          personaId: existing.personaId,
          personaName: existing.personaName,
          summary: text,
          themes: [],
          ...(vector ? { vector } : {}),
        }, previousEvent) as never);

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

  /**
   * S-56: диалог, созданный в этом же ходе, а ход отбит сервером по согласию —
   * пустая запись не остаётся. Защищать её надгробием нечем: реплик в ней нет.
   */
  async discardEmpty(id: string): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('aiDialogues', 'readwrite');
    const existing = await tx.store.get(id);
    const empty = !!existing && existing.messages.every(m => m.type === 'system' || m.content.trim() === '');
    if (empty) await tx.store.delete(id);
    await tx.done;
    if (empty) LocalStoreSyncService.scheduleStoreDelete('aiDialogues', id);
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
    // M-4: надгробие не получает системный ход и настройку объёма.
    if (!dialogue || dialogue.deletedAt) { await tx.done; return; }
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
    const hiddenLabel = lang === 'ru'
      ? '[текст заметки не выгружен: скрыта от ИИ]'
      : '[note text not exported: hidden from AI]';
    const reasoningLabel = lang === 'ru' ? 'Ход мыслей' : 'Reasoning';

    const parts: string[] = [];
    for (const m of dialogue.messages) {
      if (m.type === 'system') continue;
      if (m.role === 'user') {
        parts.push(`**${userLabel}:** ${m.content}${await attachedNoteAppendix(m.content, dialogue.documentId, db, hiddenLabel)}`);
        continue;
      }
      // DR-7: свёрнутый блок ПЕРЕД репликой ответа — там чаще всего и начинается
      // ошибка. Строка `**Коуч:** …` остаётся целой, иначе в markdown блок
      // прилипал бы к имени и разбор стал бы нечитаемым.
      const reasoning = m.reasoning?.trim();
      const block = reasoning
        ? `<details><summary>${reasoningLabel}</summary>\n\n${reasoning}\n\n</details>\n\n`
        : '';
      parts.push(`${block}**${dialogue.personaName}:** ${m.content}`);
    }

    return header + parts.join('\n\n');
  },
};
