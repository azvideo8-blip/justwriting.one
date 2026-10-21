import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { WritingDraftService } from '../WritingDraftService';

/**
 * D1-2: метку `updated_at` облачного черновика после 0043 ставит сервер, а
 * надгробие хранит `Date.now()` прибора. Сравнивать их нельзя: на спешащем
 * приборе чужой свежий черновик выглядит «старее удаления» и сносится из облака.
 */

const cloud = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  deletes: 0,
}));

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => cloud.row,
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => {
      cloud.deletes++;
      cloud.row = null;
    },
  },
}));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 21, 6, 0, 0);
let UID = '';
let caseNo = 0;
const DELETED_TEXT = 'ЧЕРНОВИК_УДАЛЁННЫЙ_D1_2';
const FRESH_TEXT = 'MARKER_D1_DRAFT_С_ДРУГОГО_УСТРОЙСТВА';

const localDraft = (): LocalDraft => ({
  userId: UID,
  title: '',
  content: DELETED_TEXT,
  seconds: 60,
  wpm: 40,
  wordCount: 3,
  pinnedThoughts: [],
  tags: [],
  activeSessionId: null,
  savedDocumentId: null,
  updatedAt: T0 - MIN,
});

async function deletedThenForeignCloudDraft(serverSkewMs: number): Promise<void> {
  await WritingDraftService.saveToLocal(localDraft());
  const res = await WritingDraftService.deleteDraft(UID);
  expect(res).toEqual({ localOk: true, cloudOk: true });
  cloud.deletes = 0;
  // Другое устройство записало новый черновик уже после удаления. Метку ряда
  // поставил сервер — она живёт на serverSkewMs относительно часов прибора.
  cloud.row = {
    userId: UID,
    title: '',
    content: FRESH_TEXT,
    seconds: 5,
    wpm: 36,
    wordCount: 4,
    pinnedThoughts: [],
    tags: [],
    activeSessionId: null,
    savedDocumentId: null,
    updatedAt: T0 + serverSkewMs,
  };
}

beforeEach(async () => {
  UID = `u_d1_2_${++caseNo}`;
  cloud.row = null;
  cloud.deletes = 0;
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('D1-2: надгробие не судит серверную метку часами прибора', () => {
  it('прибор спешит на 10 минут — чужой свежий черновик доходит и не удаляется', async () => {
    await deletedThenForeignCloudDraft(-10 * MIN);

    const loaded = await WritingDraftService.loadDraft(UID);

    expect(loaded?.content).toBe(FRESH_TEXT);
    expect(cloud.row?.content, 'облачная копия не снесена').toBe(FRESH_TEXT);
    expect(cloud.deletes, 'повторного удаления не было').toBe(0);
  });

  it('прибор отстаёт на 10 минут — тот же черновик тоже доходит', async () => {
    await deletedThenForeignCloudDraft(10 * MIN);

    const loaded = await WritingDraftService.loadDraft(UID);

    expect(loaded?.content).toBe(FRESH_TEXT);
    expect(cloud.deletes).toBe(0);
  });

  it('контроль: удалённое содержимое по-прежнему не воскресает (хэш)', async () => {
    await deletedThenForeignCloudDraft(-10 * MIN);
    cloud.row = { ...localDraft() };

    const loaded = await WritingDraftService.loadDraft(UID);

    expect(loaded).toBeNull();
    expect(cloud.deletes, 'облачное удаление дослано').toBe(1);
  });
});
