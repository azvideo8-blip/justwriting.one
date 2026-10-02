import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../../../core/storage/localDb';
import type { AIDialogue, DialogueMessage } from '../../../../core/storage/localDb';
import { AIDialogueService } from '../AIDialogueService';
import { AIChatMemoryService } from '../AIChatMemoryService';
import { restoreAIDataFromCloud } from '../AIRestoreService';

// S-35: записи диалога, которые уносили параллельную правку: слияние при
// restore читало и писало вне одной транзакции, извлечение памяти писало назад
// снимок «до вызова модели», курсор памяти вставал не на последнюю
// отправленную реплику, closingSummary не поднимал updatedAt.

const UID = 'u_s35';
const cloud: Array<{ store: string; key: string; payload: Record<string, unknown> }> = [];
const extractChatMemory = vi.fn();
const chat = vi.fn();

vi.mock('../AIService', () => ({
  AIService: {
    extractChatMemory: (...a: unknown[]) => extractChatMemory(...a),
    chat: (...a: unknown[]) => chat(...a),
    embed: async () => ({ ok: false, error: 'off' }),
  },
}));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getUserSummaries: async () => [],
    getUserEmbeddingsPaginated: async () => ({ items: [], nextCursorId: null, readCount: 0 }),
    getLocalStoreRecords: async () => cloud,
  },
}));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
}));
vi.mock('../../../../core/crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../utils/aiDegradationReporter', () => ({ reportAIDegradation: vi.fn() }));
vi.mock('../../utils/embeddingIndexer', () => ({ sha256Hex: async (s: string) => s }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: UID, email: 'someone@example.com' }) }));
vi.mock('../../../../core/services/LocalStoreSyncService', async (importActual) => ({
  ...(await importActual<typeof import('../../../../core/services/LocalStoreSyncService')>()),
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));

const DID = 'd_s35';

function m(role: 'user' | 'assistant', id: string, content: string, createdAt: number): DialogueMessage {
  return { role, id, content, createdAt };
}

function dialogue(messages: DialogueMessage[], extra: Partial<AIDialogue> = {}): AIDialogue {
  return {
    id: DID, title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    createdAt: 1000, updatedAt: 2000, messages, ...extra,
  };
}

const texts = (d: AIDialogue | undefined) => (d?.messages ?? []).map(x => x.content);

async function stored(): Promise<AIDialogue | undefined> {
  return (await getLocalDb()).get('aiDialogues', DID);
}

beforeEach(async () => {
  extractChatMemory.mockReset().mockResolvedValue({ ok: true, memories: [] });
  chat.mockReset();
  cloud.length = 0;
  localStorage.clear();
  const db = await getLocalDb();
  await db.clear('aiDialogues');
});

afterEach(() => {
  vi.useRealTimers();
  // Тест 1 подменяет методы экземпляра базы — следующий getLocalDb откроет новый.
  resetDbInstance();
});

describe('S-35: dialogue writes that dropped concurrent changes', () => {
  it('restore merge: a turn written between the read and the put survives (get+merge+put in one transaction)', async () => {
    const db = await getLocalDb();
    await db.put('aiDialogues', dialogue([m('user', 'q', 'Вопрос', 10), m('assistant', 'a', 'Ответ', 11)]));
    const fromB = dialogue(
      [m('user', 'q', 'Вопрос', 10), m('assistant', 'a', 'Ответ', 11), m('user', 'ub', 'Вопрос с B', 20), m('assistant', 'ab', 'Ответ с B', 21)],
      { updatedAt: 3000 },
    );
    cloud.push({ store: 'aiDialogues', key: DID, payload: { data: JSON.stringify(fromB), updatedAt: fromB.updatedAt } });

    // Чужая запись стартует в момент чтения диалога restore'ом: при чтении
    // вне транзакции (db.get) она успевает лечь до put и теряется; при чтении
    // внутри readwrite-транзакции она встаёт в очередь за ней и остаётся.
    let injected: Promise<void> | null = null;
    const inject = () => {
      injected ??= AIDialogueService.appendMessage(DID, 'Местный вопрос', 'Местный ответ');
      return injected;
    };
    const patched = db as unknown as {
      get: (store: string, key: string) => Promise<unknown>;
      transaction: (...a: unknown[]) => unknown;
    };
    const origGet = patched.get;
    const origTx = patched.transaction;
    patched.get = async function (this: unknown, store: string, key: string) {
      const r = await origGet.call(db, store, key);
      if (store === 'aiDialogues') await inject();
      return r;
    };
    patched.transaction = function (this: unknown, ...a: unknown[]) {
      const tx = origTx.apply(db, a);
      if (a[0] === 'aiDialogues' && a[1] === 'readwrite') void inject();
      return tx;
    };

    const res = await restoreAIDataFromCloud(UID);
    expect(injected, 'подмена не сработала — тест ничего не проверил').not.toBeNull();
    await (injected as Promise<void> | null);

    expect(res.failed).toBe(0);
    const after = texts(await stored());
    expect(after, `ход, записанный между чтением и записью, потерян: ${JSON.stringify(after)}`).toContain('Местный вопрос');
    expect(after).toContain('Местный ответ');
    expect(after).toContain('Вопрос с B');
    expect(after).toContain('Ответ с B');
  });

  it('memory extraction: a turn appended and a message deleted during the AI call are not undone by the cursor write', async () => {
    const db = await getLocalDb();
    await db.put('aiDialogues', dialogue([
      m('user', 'u1', 'Вопрос один достаточной длины', 10),
      m('assistant', 'a1', 'Ответ один достаточной длины', 11),
      m('user', 'u2', 'Вопрос два достаточной длины', 20),
      m('assistant', 'a2', 'Ответ два достаточной длины', 21),
      m('user', 'u3', 'Вопрос три достаточной длины', 30),
      m('assistant', 'a3', 'Ответ три достаточной длины', 31),
    ]));
    extractChatMemory.mockImplementation(async () => {
      await AIDialogueService.appendMessage(DID, 'Вопрос за время вызова', 'Ответ за время вызова');
      await AIDialogueService.deleteMessage(DID, 'a1');
      return { ok: true, memories: [] };
    });

    const window = (await stored())!.messages.slice(0, 5);
    await AIChatMemoryService.extractFromDialogue(DID, window);

    expect(extractChatMemory).toHaveBeenCalledTimes(1);
    const after = await stored();
    const t = texts(after);
    expect(t, `ход, дописанный за время вызова, затёрт снимком: ${JSON.stringify(t)}`).toContain('Вопрос за время вызова');
    expect(t, `удалённая реплика вернулась из снимка: ${JSON.stringify(t)}`).not.toContain('Ответ один достаточной длины');
    expect(after?.deletedMessages?.map(x => x.id)).toEqual(['a1']);
    expect(after?.lastExtractedMessageId).toBe('u3');
    expect(after?.lastExtractedIdx).toBeUndefined();
  });

  it('memory cursor: window older than the stored record — starts at the cursor in the window, lands on the last message actually sent', async () => {
    const db = await getLocalDb();
    // Слияние за время стрима вставило чужой ход (xb, ab) и ответ a4; окно
    // хука их не видело. Курсор — u3.
    const all = [
      m('user', 'u1', 'Вопрос один достаточной длины', 10),
      m('assistant', 'a1', 'Ответ один достаточной длины', 11),
      m('user', 'u2', 'Вопрос два достаточной длины', 20),
      m('assistant', 'a2', 'Ответ два достаточной длины', 21),
      m('user', 'u3', 'Вопрос три достаточной длины', 30),
      m('assistant', 'a3', 'Ответ три достаточной длины', 31),
      m('user', 'xb', 'Чужой вопрос достаточной длины', 32),
      m('assistant', 'ab', 'Чужой ответ достаточной длины', 33),
      m('user', 'u4', 'Вопрос четыре достаточной длины', 40),
      m('assistant', 'a4', 'Ответ четыре достаточной длины', 41),
    ];
    await db.put('aiDialogues', dialogue(all, { lastExtractedMessageId: 'u3' }));
    // Свежий вопрос в окне хука ещё без id.
    const window = [...all.slice(0, 6), { role: 'user' as const, content: all[8]!.content }];

    await AIChatMemoryService.extractFromDialogue(DID, window);

    const sent = (extractChatMemory.mock.calls[0]![0] as { messages: { content: string }[] }).messages.map(x => x.content);
    expect(sent, `старый префикс ушёл в модель второй раз: ${JSON.stringify(sent)}`).not.toContain('Вопрос один достаточной длины');
    expect(sent[0]).toBe('Вопрос два достаточной длины');
    expect(sent).toContain('Вопрос четыре достаточной длины');
    expect((await stored())?.lastExtractedMessageId, 'курсор не на последней отправленной реплике').toBe('u4');
  });

  it('closingSummary raises updatedAt so the other device pulls it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(10_000);
    const db = await getLocalDb();
    await db.put('aiDialogues', dialogue([
      m('user', 'u1', 'Вопрос один', 10), m('assistant', 'a1', 'Ответ один', 11),
      m('user', 'u2', 'Вопрос два', 20), m('assistant', 'a2', 'Ответ два', 21),
    ], { updatedAt: 10_000 }));
    chat.mockResolvedValue({ ok: true, text: 'Итог разговора' });

    vi.setSystemTime(50_000);
    await AIDialogueService.generateClosingSummary(DID);

    const after = await stored();
    expect(after?.closingSummary).toBe('Итог разговора');
    expect(after?.updatedAt, 'итог записан со старой отметкой — инкрементальный забор его не увидит').toBe(50_000);
  });
});
