// Ревью кандидата 0.11.7 (05.11). Настоящий мутатор и fake-indexeddb, края — отказ чтения базы и облако.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as localDbModule from '../../../../core/storage/localDb';
import { resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { useContentStore } from '../../store/useContentStore';
import { applySessionEnd, resolve } from '../draftWriter';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const scene = vi.hoisted(() => ({
  failRead: false,
  cloud: null as Record<string, unknown> | null,
  deletes: 0,
  duringCloudRead: null as null | (() => void),
}));

vi.mock('../../../../core/storage/localDb', async (importActual) => {
  const actual = await importActual<typeof localDbModule>();
  return {
    ...actual,
    getLocalDb: vi.fn(async (uid?: string | null) => {
      const db = await actual.getLocalDb(uid ?? undefined);
      if (!scene.failRead) return db;
      return new Proxy(db, {
        get(target, prop) {
          if (prop === 'get') return async () => { throw new Error('IDB не читается'); };
          const value = Reflect.get(target, prop) as unknown;
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
    }),
  };
});

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => {
      await new Promise(r => setTimeout(r, 20));
      scene.duringCloudRead?.();
      return scene.cloud;
    },
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => { scene.deletes++; },
  },
}));

const T0 = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const realNow = Date.now;
const row = (uid: string, content: string, updatedAt: number) => ({
  userId: uid, owner: uid, content, title: '', seconds: 1, wpm: 1, wordCount: 1, pinnedThoughts: [], tags: [],
  activeSessionId: null, savedDocumentId: null, sessionStartTime: null, updatedAt,
});
let uid = '';
let n = 0;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  uid = `u_rc_${++n}`;
  Object.assign(scene, { failRead: false, cloud: null, deletes: 0, duringCloudRead: null });
  useContentStore.setState({ content: '', title: '' });
  Date.now = () => T0;
});

afterEach(() => {
  Date.now = realNow;
  useContentStore.setState({ content: '', title: '' });
});

describe('гость: база не читается', () => {
  it('единственная копия в localStorage возвращается, а не «черновика нет»', async () => {
    const guest = `guest_rc_${++n}`;
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify(row(guest, 'ГОСТЬ_КОПИЯ', T0)));
    scene.failRead = true;
    expect((await resolve(guest, { guest: true }))?.content, 'копию сочли отсутствующей, и следующая запись её затрёт').toBe('ГОСТЬ_КОПИЯ');
  });

  it('просроченная копия не показывается, но и не стирается вслепую', async () => {
    const guest = `guest_rc_${++n}`;
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify(row(guest, 'ГОСТЬ_СТАРОЕ', T0 - 60 * DAY)));
    scene.failRead = true;
    expect(await resolve(guest, { guest: true })).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT), 'удалили, не прочитав базу').not.toBeNull();
  });
});

describe('аккаунт: база не читается, облако есть', () => {
  it('просроченная копия вкладки не сносит непрочитанную строку и облако', async () => {
    localStorage.setItem(STORAGE_KEYS.DRAFT(uid), JSON.stringify(row(uid, 'КОПИЯ_СТАРАЯ', T0 - 8 * DAY)));
    scene.cloud = row(uid, 'ОБЛАКО_СТАРШЕ', T0 - 9 * DAY);
    scene.failRead = true;
    expect(await resolve(uid)).toBeNull();
    expect(scene.deletes, 'удалили облачную строку при непрочитанной базе').toBe(0);
  });
});

describe('принятие облачной копии', () => {
  it('в редакторе набирают: строку облачной копией не перезаписываем', async () => {
    const db = await localDbModule.getLocalDb(uid);
    await db.put('drafts', { ...row(uid, 'УЖЕ_В_СТРОКЕ', T0 - 1000), _cloudUpdatedAt: T0 - 5000 } as unknown as LocalDraft);
    scene.cloud = row(uid, 'ОБЛАКО_НОВЕЕ', T0 + 120_000);
    scene.duringCloudRead = () => { useContentStore.setState({ content: 'НАБРАНО_В_ЧТЕНИИ' }); };
    await resolve(uid);
    const stored = await db.get('drafts', uid) as LocalDraft | undefined;
    expect(stored?.content, 'принятие затёрло строку, пока человек печатает').toBe('УЖЕ_В_СТРОКЕ');
  });

  it('контроль: редактор пуст — облачная копия принята и записана', async () => {
    const db = await localDbModule.getLocalDb(uid);
    await db.put('drafts', { ...row(uid, 'УЖЕ_В_СТРОКЕ', T0 - 1000), _cloudUpdatedAt: T0 - 5000 } as unknown as LocalDraft);
    scene.cloud = row(uid, 'ОБЛАКО_НОВЕЕ', T0);
    expect((await resolve(uid))?.content).toBe('ОБЛАКО_НОВЕЕ');
    expect((await db.get('drafts', uid) as LocalDraft | undefined)?.content).toBe('ОБЛАКО_НОВЕЕ');
  });

  it('конец сессии при чтении и только облачная копия: ответ есть, строка не записана', async () => {
    scene.cloud = row(uid, 'ТОЛЬКО_ОБЛАКО', T0);
    scene.duringCloudRead = () => { applySessionEnd(uid); };
    expect((await resolve(uid))?.content).toBe('ТОЛЬКО_ОБЛАКО');
  });
});
