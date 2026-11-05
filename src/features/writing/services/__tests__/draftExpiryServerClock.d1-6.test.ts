import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { WritingDraftService } from '../WritingDraftService';
import { resolve } from '../draftWriter';

/**
 * D1-6 (П-6): срок черновика (7 суток) считался `Date.now()` прибора против
 * метки, которую облачной копии после 0043 ставит сервер. На спешащем приборе
 * свежий чужой черновик «просрочен» и сносится вместе с облачной копией.
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

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 21, 6, 0, 0);
let UID = '';
let caseNo = 0;

const draft = (updatedAt: number, content = 'MARKER_D1_6'): LocalDraft => ({
  userId: UID,
  title: '',
  content,
  seconds: 60,
  wpm: 40,
  wordCount: 3,
  pinnedThoughts: [],
  tags: [],
  activeSessionId: null,
  savedDocumentId: null,
  updatedAt,
});

beforeEach(async () => {
  UID = `u_d1_6_${++caseNo}`;
  cloud.row = null;
  cloud.deletes = 0;
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('D1-6: срок черновика не судит серверную метку часами прибора', () => {
  it('прибор спешит на 8 суток — свежий облачный черновик не удаляется', async () => {
    vi.setSystemTime(T0 + 8 * DAY);
    cloud.row = { ...draft(T0), } as Record<string, unknown>;

    const loaded = await resolve(UID);

    expect(loaded?.content, 'свежий облачный черновик доходит').toBe('MARKER_D1_6');
    expect(cloud.deletes, 'облачная копия не снесена').toBe(0);
  });

  it('контроль: локальный черновик старше 7 суток по часам этого прибора истекает', async () => {
    vi.setSystemTime(T0);
    await WritingDraftService.saveToLocal(draft(T0 - 8 * DAY));

    const loaded = await resolve(UID);

    expect(loaded).toBeNull();
  });
});
