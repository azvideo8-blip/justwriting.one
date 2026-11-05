// Приёмка DW-6, ревьюер 04.11. Настоящий мутатор и fake-indexeddb.
// 1. Заметку сохранили, пока resolve ждал облако: прочитанная до сохранения локальная
//    копия — это уже сохранённый текст, черновиком он не возвращается.
// 2. Текст, набранный ДО начала чтения, и заголовок, набранный во время него, — тоже
//    набранное: resolve не закрывает черновик поверх них.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { useContentStore } from '../../store/useContentStore';
import { applySave, applySessionEnd, getDraftGeneration, resolve } from '../draftWriter';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const scene = vi.hoisted(() => ({ duringCloudRead: null as null | (() => void) }));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => {
      // Строка базы к этому моменту уже прочитана: resolve читает половины параллельно.
      await new Promise(r => setTimeout(r, 20));
      scene.duringCloudRead?.();
      return null;
    },
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => {},
  },
}));

const T0 = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const realNow = Date.now;
let uid = '';
let n = 0;

async function seed(over: Record<string, unknown> = {}): Promise<void> {
  const db = await getLocalDb(uid);
  await db.put('drafts', {
    userId: uid, owner: uid, content: 'УЖЕ_В_ЗАМЕТКЕ_DW6R', title: '', seconds: 1, wpm: 1, wordCount: 1,
    pinnedThoughts: [], tags: [], activeSessionId: null, savedDocumentId: null, sessionStartTime: null,
    updatedAt: T0, ...over,
  } as unknown as LocalDraft);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  uid = `u_dw6r_${++n}`;
  scene.duringCloudRead = null;
  useContentStore.setState({ content: '', title: '' });
  Date.now = () => T0;
});

afterEach(() => {
  Date.now = realNow;
  useContentStore.setState({ content: '', title: '' });
});

describe('resolve: закрытие во время чтения', () => {
  it('заметку сохранили, пока ждали облако: сохранённый текст черновиком не возвращается', async () => {
    await seed();
    scene.duringCloudRead = () => { applySave(uid); };
    expect(await resolve(uid), 'сохранённый текст вернулся черновиком').toBeNull();
  });

  it('конец сессии во время чтения не закрывает черновик: локальная копия остаётся ответом', async () => {
    await seed();
    scene.duringCloudRead = () => { applySessionEnd(uid); };
    expect((await resolve(uid))?.content).toBe('УЖЕ_В_ЗАМЕТКЕ_DW6R');
  });
});

describe('resolve: набранное не закрывается удалением', () => {
  it('текст набран до начала чтения: просроченная строка не закрывает черновик', async () => {
    await seed({ updatedAt: T0 - 8 * DAY });
    useContentStore.setState({ content: 'ПЕЧАТЬ_ДО_ЧТЕНИЯ' });
    const before = getDraftGeneration(uid);
    await resolve(uid);
    expect(getDraftGeneration(uid), 'черновик закрыт поверх набранного').toBe(before);
  });

  it('заголовок набран во время чтения: просроченная строка не закрывает черновик', async () => {
    await seed({ updatedAt: T0 - 8 * DAY });
    const before = getDraftGeneration(uid);
    const db = await getLocalDb(uid);
    const realGet = db.get.bind(db);
    vi.spyOn(db, 'get').mockImplementation((async (...a: Parameters<typeof realGet>) => {
      useContentStore.setState({ title: 'ЗАГОЛОВОК_В_ЧТЕНИИ' });
      return realGet(...a);
    }) as typeof db.get);
    await resolve(uid);
    expect(getDraftGeneration(uid), 'черновик закрыт поверх заголовка').toBe(before);
  });

  it('контроль: редактор пуст и не менялся — просроченное удаляется', async () => {
    await seed({ updatedAt: T0 - 8 * DAY });
    const before = getDraftGeneration(uid);
    await resolve(uid);
    expect(getDraftGeneration(uid)).toBe(before + 1);
    expect(await (await getLocalDb(uid)).get('drafts', uid)).toBeUndefined();
  });
});
