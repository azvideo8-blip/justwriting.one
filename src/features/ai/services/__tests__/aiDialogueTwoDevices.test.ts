import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../../../core/storage/localDb';
import type { AIDialogue } from '../../../../core/storage/localDb';
import { AIDialogueService } from '../AIDialogueService';
import { restoreAIDataFromCloud } from '../AIRestoreService';

// S-29: два устройства ответили в один диалог. Прежний LWW («облако свежее —
// перезаписать») уносил ход того, кто ответил первым, молча.

const cloud = new Map<string, { store: string; key: string; payload: Record<string, unknown> }>();

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getUserSummaries: async () => [],
    getUserEmbeddingsPaginated: async () => ({ items: [], nextCursorId: null, readCount: 0 }),
    getLocalStoreRecords: async () => [...cloud.values()],
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
vi.mock('../../../utils/embeddingIndexer', () => ({ sha256Hex: async (s: string) => s }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_s29', email: 'someone@example.com' }) }));

const UID = 'u_s29';

class Device {
  readonly factory = new IDBFactory();
  readonly storage = new Map<string, string>();
}

let currentDevice: Device | null = null;

function use(dev: Device): void {
  if (currentDevice === dev) return;
  if (currentDevice) {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      currentDevice.storage.set(k, localStorage.getItem(k)!);
    }
  }
  localStorage.clear();
  for (const [k, v] of dev.storage) localStorage.setItem(k, v);
  resetDbInstance();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = dev.factory;
  currentDevice = dev;
}

// То, что LocalStoreSyncService отправляет в облако: JSON записи плюс её
// updatedAt рядом с payload.
async function uploadDialogues(): Promise<void> {
  const db = await getLocalDb();
  for (const rec of await db.getAll('aiDialogues')) {
    const d = rec as AIDialogue;
    cloud.set(`${d.id}`, {
      store: 'aiDialogues',
      key: d.id,
      payload: { data: JSON.stringify(d), updatedAt: d.updatedAt },
    });
  }
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

beforeEach(async () => {
  vi.clearAllMocks();
  cloud.clear();
});

describe('S-29: two devices answering the same dialogue', () => {
  it('after both sync, neither turn is lost', async () => {
    const a = new Device();
    const b = new Device();

    use(a);
    const dialogue = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [
        { role: 'user', content: 'Общий вопрос' },
        { role: 'assistant', content: 'Общий ответ' },
      ],
    });

    // Устройство B получило ту же запись до расхождения.
    use(b);
    await (await getLocalDb()).put('aiDialogues', dialogue);

    await wait(2);
    await AIDialogueService.appendMessage(dialogue.id, 'Вопрос с B', 'Ответ с B');

    use(a);
    await wait(2);
    await AIDialogueService.appendMessage(dialogue.id, 'Вопрос с A', 'Ответ с A');

    // A выгружается в облако, B забирает оттуда — облако свежее по часам,
    // прежний LWW перезаписал бы им локальный ход.
    await uploadDialogues();
    use(b);
    await restoreAIDataFromCloud(UID);

    const onB = ((await (await getLocalDb()).get('aiDialogues', dialogue.id)) as AIDialogue).messages;
    expect(onB.map(m => m.content), `ходы с A потеряны: ${JSON.stringify(onB.map(m => m.content))}`)
      .toEqual(['Общий вопрос', 'Общий ответ', 'Вопрос с B', 'Ответ с B', 'Вопрос с A', 'Ответ с A']);

    // B выгружает союз — и A, забрав его, приходит к тому же списку.
    await uploadDialogues();
    use(a);
    await restoreAIDataFromCloud(UID);
    const onA = ((await (await getLocalDb()).get('aiDialogues', dialogue.id)) as AIDialogue).messages;
    expect(onA.map(m => m.id)).toEqual(onB.map(m => m.id));
  });
});
