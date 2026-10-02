import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { LocalStoreSyncService } from '../LocalStoreSyncService';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';

// S-54 (S-34): облачная строка диалога, которую не прочитать, роняла выгрузку
// пять раз подряд и запись становилась мёртвой — новые ходы навсегда
// оставались на устройстве. Открытая строка под включённым сейфом (обрыв
// «зашифровать всё») читаема: сливаем и пишем обратно зашифрованной. Строка,
// нечитаемая по-настоящему, остаётся ошибкой — но один раз видна в журнале.

const UID = 'u_s54';
type Row = { store: string; key: string; payload: Record<string, unknown> };
const cloud = new Map<string, Row>();

vi.mock('../../data', () => ({
  DataProvider: {
    getLocalStoreRecord: async (_u: string, store: string, key: string) => {
      const r = cloud.get(`${store}:${key}`);
      return r ? { store, key, payload: r.payload } : null;
    },
    getLocalStoreRecordPages: async () => [],
    saveLocalStoreRecord: async (_u: string, store: string, key: string, payload: Record<string, unknown>) => { cloud.set(`${store}:${key}`, { store, key, payload }); },
    saveLocalStoreRecordIfUnchanged: async (_u: string, store: string, key: string, payload: Record<string, unknown>, expected: number | null) => {
      const cur = cloud.get(`${store}:${key}`);
      if (expected === null ? cur !== undefined : cur?.payload.updatedAt !== expected) return false;
      cloud.set(`${store}:${key}`, { store, key, payload });
      return true;
    },
    deleteLocalStorePagedRecords: async () => {},
  },
}));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
// Сейф включён: шифрование — пометка `enc:`; открытая строка с текстом под
// сейфом — DecryptionError с причиной PLAINTEXT_UNDER_VAULT, как в cryptoHelpers.
vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => true,
  maybeEncrypt: async (doc: Record<string, unknown>) => ({ ...doc, data: `enc:${String(doc.data)}`, _encrypted: true }),
  maybeDecrypt: async (doc: Record<string, unknown>) => {
    if (doc._encrypted !== true) {
      const e = new Error('DECRYPTION_FAILED: "_encrypted"');
      e.name = 'DecryptionError';
      (e as { cause?: unknown }).cause = new Error('PLAINTEXT_UNDER_VAULT');
      throw e;
    }
    const data = String(doc.data);
    if (!data.startsWith('enc:')) {
      const e = new Error('DECRYPTION_FAILED: "data"');
      e.name = 'DecryptionError';
      throw e;
    }
    return { ...doc, data: data.slice(4) };
  },
}));
vi.mock('../../crypto/encrypt', () => ({ getSessionKey: () => new Uint8Array(32) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../auth', () => ({ getCurrentUser: () => ({ uid: UID, email: 'someone@example.com' }), getCurrentUserId: () => UID }));

function dialogue(id: string, extra: string[], updatedAt: number): AIDialogue {
  return {
    id, title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯', schema: 2,
    createdAt: 1000, updatedAt,
    messages: [
      { id: 'u0', role: 'user', content: 'Общий вопрос', createdAt: 10 },
      { id: 'a0', role: 'assistant', content: 'Общий ответ', createdAt: 11, turnId: 'u0' },
      ...extra.map((c, i) => ({ id: `x_${c.length}_${i}`, role: 'user' as const, content: c, createdAt: 100 + i })),
    ],
  };
}

const texts = (d: AIDialogue) => d.messages.map(m => m.content);

beforeEach(async () => {
  cloud.clear();
  localStorage.clear();
  useActivityLogStore.getState().clearLog();
  const db = await getLocalDb();
  await db.clear('aiDialogues');
});

describe('S-54: an unreadable cloud dialogue row', () => {
  it('a plaintext row under the vault is read, merged, and written back encrypted', async () => {
    const cloudCopy = dialogue('d1', ['Ход из облака'], 2000);
    cloud.set('aiDialogues:d1', { store: 'aiDialogues', key: 'd1', payload: { data: JSON.stringify(cloudCopy), updatedAt: 2000 } });
    const db = await getLocalDb();
    await db.put('aiDialogues', dialogue('d1', ['Ход с устройства'], 3000));

    LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'd1');
    const r = await LocalStoreSyncService.flushPending(true);

    expect(r).toMatchObject({ synced: 1, failed: 0 });
    const row = cloud.get('aiDialogues:d1')!.payload;
    expect(row._encrypted, 'строка записана обратно открытой').toBe(true);
    const stored = JSON.parse(String(row.data).slice(4)) as AIDialogue;
    expect(texts(stored)).toEqual(['Общий вопрос', 'Общий ответ', 'Ход из облака', 'Ход с устройства']);
  });

  it('a genuinely undecryptable row stays an error (not an empty cloud) and is reported in the activity log once', async () => {
    cloud.set('aiDialogues:d2', { store: 'aiDialogues', key: 'd2', payload: { data: 'garbage', updatedAt: 2000, _encrypted: true } });
    const db = await getLocalDb();
    await db.put('aiDialogues', dialogue('d2', ['Ход с устройства'], 3000));

    LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'd2');
    const r1 = await LocalStoreSyncService.flushPending(true);
    const r2 = await LocalStoreSyncService.flushPending(true);

    expect(r1.failed).toBe(1);
    expect(r2.failed).toBe(1);
    expect(cloud.get('aiDialogues:d2')!.payload.data, 'нечитаемая строка затёрта слепой записью').toBe('garbage');
    const entries = useActivityLogStore.getState().entries.filter(e => e.message === 'activity_dialogue_cloud_unreadable');
    expect(entries.map(e => e.context?.key)).toEqual(['d2']);
  });
});
