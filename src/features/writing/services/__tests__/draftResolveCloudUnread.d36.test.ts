// Дейлик 05.11 Н-1: «облако не ответило» — не «облака нет». Настоящий мутатор и
// fake-indexeddb, мокается только край (DataProvider).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { rateLimitTuning } from '../../../../core/services/rateGate';
import { resolve } from '../draftWriter';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const cloud = vi.hoisted(() => ({
  mode: 'row' as 'row' | 'fail' | 'none' | 'broken' | '429-once',
  deletes: 0,
  calls: 0,
}));
const T0 = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const cloudRow = () => ({
  userId: 'x', content: 'ОБЛАКО_ЧУЖОЕ_D36', title: '', seconds: 1, wpm: 1, wordCount: 1, pinnedThoughts: [], tags: [],
  activeSessionId: null, savedDocumentId: null, sessionStartTime: null, updatedAt: T0 - 1000,
});
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => {
      cloud.calls++;
      if (cloud.mode === 'fail') throw new Error('Failed to fetch');
      if (cloud.mode === '429-once' && cloud.calls === 1) throw Object.assign(new Error('Too Many Requests'), { code: '429' });
      if (cloud.mode === 'none') return null;
      if (cloud.mode === 'broken') return { content: 123 };
      return cloudRow();
    },
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => { cloud.deletes++; },
  },
}));

const realNow = Date.now;
const savedTuning = { ...rateLimitTuning };
let uid = '';
let n = 0;

async function seedExpired(): Promise<void> {
  const db = await getLocalDb(uid);
  await db.put('drafts', {
    userId: uid, owner: uid, content: 'ПРОСРОЧЕННОЕ_D36', title: '', seconds: 1, wpm: 1, wordCount: 1, pinnedThoughts: [],
    tags: [], activeSessionId: null, savedDocumentId: null, sessionStartTime: null, updatedAt: T0 - 8 * DAY,
  } as unknown as LocalDraft);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  uid = `u_d36_${++n}`;
  Object.assign(cloud, { mode: 'row', deletes: 0, calls: 0 });
  rateLimitTuning.baseMs = 1;
  rateLimitTuning.maxMs = 1;
  // Часы идут: тормоз 429 ждёт по `Date.now`, и застывшие часы повесили бы его навсегда.
  const start = realNow();
  Date.now = () => T0 + (realNow() - start);
});

afterEach(() => {
  Date.now = realNow;
  Object.assign(rateLimitTuning, savedTuning);
});

describe('resolve: облако не прочитано', () => {
  it('сбой чтения: просроченная своя строка снесена, облачная не тронута, досылка помечена', async () => {
    await seedExpired();
    cloud.mode = 'fail';
    expect(await resolve(uid)).toBeNull();
    expect(cloud.deletes, 'снесли облачную строку, которую не видели').toBe(0);
    expect(await (await getLocalDb(uid)).get('drafts', uid)).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(uid))).not.toBeNull();
  });

  it('битая облачная строка — тоже не прочитана: удаления нет', async () => {
    await seedExpired();
    cloud.mode = 'broken';
    await resolve(uid);
    expect(cloud.deletes, 'снесли строку, которую не смогли разобрать').toBe(0);
  });

  it('досылка при следующем чтении: облако ответило чужим содержимым — строка цела и принята', async () => {
    await seedExpired();
    cloud.mode = 'fail';
    await resolve(uid);
    cloud.mode = 'row';
    expect((await resolve(uid))?.content).toBe('ОБЛАКО_ЧУЖОЕ_D36');
    expect(cloud.deletes).toBe(0);
  });

  it('429 на чтении черновика повторяется, а не считается отказом', async () => {
    cloud.mode = '429-once';
    expect((await resolve(uid))?.content).toBe('ОБЛАКО_ЧУЖОЕ_D36');
    expect(cloud.calls).toBe(2);
  });

  it('контроль: облако ответило «строки нет» — удаление полное', async () => {
    await seedExpired();
    cloud.mode = 'none';
    await resolve(uid);
    expect(cloud.deletes).toBe(1);
  });
});
