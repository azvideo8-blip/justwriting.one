// DW6-2 (§4.3 строка 6): `resolve` — единственное чтение при загрузке, и его
// главная ловушка задокументирована в репо: неудачное чтение — НЕ «ничего нет»
// (I7). Каждый отказ половины обязан дожить до `resolve` дословно: при сбое
// локальной половины ничего не удаляется и облачная копия не затирает локальную;
// при отказе или таймауте облака локальная остаётся единственной.
// Мутации (приёмка 6): «удалить при localFailed» — красные кейсы 1 и 2;
// «кэшировать облачную копию при localFailed» — красный кейс 3; снять ветку
// `!localFailed` перед кэшированием — красный кейс 6.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { applyDelete, resolve } from '../draftWriter';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
const reportError = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/errors/reportError', () => ({ reportError }));

const cloud = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  mode: 'ok' as 'ok' | 'throw' | 'slow' | 'invalid',
  deletes: 0,
}));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => {
      if (cloud.mode === 'throw') throw new Error('cloud unavailable');
      if (cloud.mode === 'slow') await new Promise(r => { setTimeout(r, 30_000); });
      if (cloud.mode === 'invalid') return { garbage: true };
      return cloud.row;
    },
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => { cloud.deletes++; cloud.row = null; },
  },
}));

// Чтение базы аккаунта может «отказаться» — локальная половина тогда прочитана
// не была. База гостя и все остальные адреса работают по-настоящему.
const fail = vi.hoisted(() => ({ localRead: false, deletes: 0 }));
vi.mock('../../../../core/storage/localDb', async (importActual) => {
  const actual = await importActual<typeof import('../../../../core/storage/localDb')>();
  return {
    ...actual,
    getLocalDb: vi.fn(async (uid?: string | null) => {
      const db = await actual.getLocalDb(uid ?? undefined);
      if (!fail.localRead || uid !== 'u_dw62') return db;
      fail.deletes = 0;
      return {
        objectStoreNames: db.objectStoreNames,
        get: vi.fn(async () => { throw new Error('IDB read error'); }),
        put: vi.fn(),
        delete: vi.fn(async () => { fail.deletes++; }),
        transaction: vi.fn(() => { throw new Error('IDB read error'); }),
        done: Promise.resolve(),
      } as unknown as typeof db;
    }),
  };
});

const UID = 'u_dw62';
const T0 = 1_800_000_000_000;
const realNow = Date.now;
const DAY = 24 * 60 * 60 * 1000;

async function seedRow(content: string, over: Record<string, unknown> = {}): Promise<void> {
  const db = await getLocalDb(UID);
  await db.put('drafts', {
    userId: UID, owner: UID, content, title: '', seconds: 10, wpm: 20, wordCount: 3,
    pinnedThoughts: [], tags: [], activeSessionId: null, updatedAt: T0, ...over,
  } as unknown as LocalDraft);
}

async function realRowText(): Promise<string | undefined> {
  fail.localRead = false;
  const db = await getLocalDb(UID);
  return ((await db.get('drafts', UID)) as LocalDraft | undefined)?.content;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  vi.clearAllMocks();
  cloud.row = null;
  cloud.mode = 'ok';
  cloud.deletes = 0;
  fail.localRead = false;
  fail.deletes = 0;
  Date.now = () => T0;
});

afterEach(() => {
  Date.now = realNow;
  fail.localRead = false;
});

describe('DW6-2: отказ чтения половины — не «черновика нет»', () => {
  it('локальная база не читается: надгробие ничего не сносит, принята облачная копия', async () => {
    // Под надгробием то же содержимое, что лежит в облаке: полное удаление
    // снесло бы и локальную половину, которую мы не смогли прочесть.
    await seedRow('УДАЛЁННЫЙ_ТЕКСТ_DW62');
    await applyDelete(UID, 'tombstone');
    // В облаке — ровно то содержимое, что ушло под надгробие (хэш совпадает).
    cloud.row = {
      userId: UID, content: 'УДАЛЁННЫЙ_ТЕКСТ_DW62', title: '', seconds: 10, wpm: 20, wordCount: 3,
      pinnedThoughts: [], tags: [], activeSessionId: null, savedDocumentId: null,
      sessionStartTime: null, updatedAt: T0 - 60_000,
    };
    fail.localRead = true;
    // SETUP-удаление уже сработало — считаем только то, что сделает `resolve`.
    cloud.deletes = 0;

    const got = await resolve(UID);

    // Надгробие узнаёт содержимое → показывать нечего, но и удалять нельзя:
    // локальную половину мы не прочитали, а в ней может быть новая работа.
    expect(got).toBeNull();
    expect(cloud.deletes, 'надгробие снесло облачную строку, не прочитав локальную').toBe(0);
    expect(fail.deletes, 'при localFailed удаляется из непрочитанной базы').toBe(0);
  });

  it('локальная база не читается, а LS-копия просрочена: стирания нет', async () => {
    fail.localRead = true;
    localStorage.setItem(STORAGE_KEYS.DRAFT(UID), JSON.stringify({ content: 'ПРОСРОЧЕНО_DW62', updatedAt: T0 - 8 * DAY }));

    const got = await resolve(UID);

    // Просроченное не показывается, но и не удаляется из базы, которую не прочли.
    expect(got).toBeNull();
    expect(fail.deletes, 'просроченное стёрто из непрочитанной базы').toBe(0);
  });

  it('облако недоступно (отказ): локальная копия остаётся и не затирается', async () => {
    await seedRow('СВОЙ_ТЕКСТ_DW62');
    cloud.mode = 'throw';

    const got = await resolve(UID);

    expect(got?.content).toBe('СВОЙ_ТЕКСТ_DW62');
    expect(await realRowText()).toBe('СВОЙ_ТЕКСТ_DW62');
  });

  it('облако не ответило за отведённый срок: локальная работа остаётся', async () => {
    await seedRow('СВОЙ_ТЕКСТ_ТАЙМАУТ_DW62');
    cloud.mode = 'slow';
    cloud.row = { userId: UID, content: 'ОБЛАКО_ПОЗДНО', title: '', wordCount: 4, updatedAt: T0 + 10_000 };

    const got = await resolve(UID);

    expect(got?.content, 'таймаут облака не имеет права затерять локальную работу').toBe('СВОЙ_ТЕКСТ_ТАЙМАУТ_DW62');
  }, 30_000);

  it('битая облачная строка не доходит до сравнений: побеждает локальная', async () => {
    await seedRow('СВОЙ_ТЕКСТ_ПРОТИВ_МУСОРА_DW62');
    cloud.mode = 'invalid';

    const got = await resolve(UID);

    expect(got?.content).toBe('СВОЙ_ТЕКСТ_ПРОТИВ_МУСОРА_DW62');
    expect(reportError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'loadDraft_cloud_invalid' }));
  });

  it('принятая облачная копия кэшируется через мутатор и помнит свою метку', async () => {
    await seedRow('ЛОКАЛЬНОЕ_СТАРОЕ_DW62', { _cloudUpdatedAt: T0 - 120_000, updatedAt: T0 - 120_000 });
    cloud.row = { userId: UID, content: 'ОБЛАКО_НОВЕЕ_DW62', title: '', wordCount: 6, updatedAt: T0 - 10_000 };

    const got = await resolve(UID);

    expect(got?.content).toBe('ОБЛАКО_НОВЕЕ_DW62');
    expect(await realRowText(), 'облачная копия не закеширована в строку').toBe('ОБЛАКО_НОВЕЕ_DW62');
    const db = await getLocalDb(UID);
    const stored = await db.get('drafts', UID) as unknown as Record<string, unknown>;
    expect(stored._cloudAckedHash, 'принятая копия не запомнила свой хэш').toBeTruthy();
    expect(stored._cloudUpdatedAt).toBe(T0 - 10_000);
  });

  it('локальная база не читается: принятая из облака копия в неё не пишется', async () => {
    await seedRow('ЛОКАЛЬНОЕ_СТАРОЕ_DW62', { _cloudUpdatedAt: T0 - 120_000, updatedAt: T0 - 120_000 });
    cloud.row = { userId: UID, content: 'ОБЛАКО_НОВЕЕ_DW62', title: '', wordCount: 6, updatedAt: T0 - 10_000 };
    fail.localRead = true;

    const got = await resolve(UID);
    expect(got?.content).toBe('ОБЛАКО_НОВЕЕ_DW62');

    // База снова читается: в неё не должно быть приехавшей записи поверх того,
    // чего мы не прочли.
    fail.localRead = false;
    expect(await realRowText(), 'облако затёрло локальную строку, которую не прочитали').toBe('ЛОКАЛЬНОЕ_СТАРОЕ_DW62');
  });
});
