// Открытый вопрос 3: чтение облака не удалось — неизвестно, лежит ли там черновик, и отправка
// не должна его затереть. Настоящий мутатор и сервис, мокается только край (DataProvider).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { rateLimitTuning } from '../../../../core/services/rateGate';
import { isCloudDraftLocked, isCloudDraftUnread, resolve } from '../draftWriter';
import { WritingDraftService } from '../WritingDraftService';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const cloud = vi.hoisted(() => ({ read: 'fail' as 'fail' | 'locked' | 'none' | 'undecryptable', saves: 0 }));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => {
      if (cloud.read === 'fail') throw new Error('Failed to fetch');
      if (cloud.read === 'locked') throw new Error('LOCKED');
      if (cloud.read === 'undecryptable') throw Object.assign(new Error('DECRYPTION_FAILED: "content"'), { name: 'DecryptionError' });
      return null;
    },
    saveDraft: async () => { cloud.saves++; return null; },
    updateDraft: async () => {},
    deleteDraft: async () => {},
  },
}));

let uid = '';
let n = 0;
const typed = (): LocalDraft => ({
  userId: uid, owner: uid, content: 'НАБРАНО', title: '', seconds: 1, wpm: 1, wordCount: 1, pinnedThoughts: [],
  tags: [], activeSessionId: null, savedDocumentId: null, sessionStartTime: null, updatedAt: Date.now(),
} as unknown as LocalDraft);

beforeEach(() => {
  localStorage.clear();
  resetDbInstance();
  uid = `unread_${++n}`;
  cloud.read = 'fail';
  cloud.saves = 0;
  rateLimitTuning.baseMs = 1;
});

describe('отправка черновика ждёт чтения облака', () => {
  it('облако не ответило: своей копии нет, отправка не идёт', async () => {
    expect(await resolve(uid)).toBeNull();
    expect(isCloudDraftUnread(uid)).toBe(true);
    expect(await WritingDraftService.saveDraftToCloud(typed())).toBe(false);
    expect(cloud.saves).toBe(0);
  });

  it('чтение удалось: отправка снова идёт', async () => {
    await resolve(uid);
    cloud.read = 'none';
    await resolve(uid);
    expect(isCloudDraftUnread(uid)).toBe(false);
    expect(await WritingDraftService.saveDraftToCloud(typed())).toBe(true);
    expect(cloud.saves).toBe(1);
  });

  it('запертый сейф — другой исход: его повторяет открытие сейфа', async () => {
    cloud.read = 'locked';
    await resolve(uid);
    expect(isCloudDraftLocked()).toBe(true);
    expect(isCloudDraftUnread(uid)).toBe(false);
  });

  it('строка прочитана, но нечитаема: это ответ, отправка её заменяет', async () => {
    cloud.read = 'undecryptable';
    await resolve(uid);
    expect(isCloudDraftUnread(uid)).toBe(false);
    expect(await WritingDraftService.saveDraftToCloud(typed())).toBe(true);
    expect(cloud.saves).toBe(1);
  });
});
