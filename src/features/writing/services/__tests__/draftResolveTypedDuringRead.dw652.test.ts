// DW6-5.2 (находка ревью 0.11.6, «это потеря текста»): ветки `resolve`, которые
// сносят просроченный или удалённый черновик, поднимали эпоху (`applySave`) и
// закрывали черновик, даже если в редакторе уже стояла новая печать — правка
// пришла, пока читали базу и облако (до 10 с). Закрытый черновик автосохранение и
// копия при закрытии вкладки больше не пишут (`mayAccountWriteEditorText`,
// `isDraftClosed`), а интерфейс остаётся с «Сохранено».
//
// Правило: если ТЕКСТ РЕДАКТОРА изменился с начала чтения, `resolve` ничего не
// закрывает и не удаляет — он только отвечает, что загружать нечего. «Нет
// решения» не равно «удалить».
//
// Мутации (приёмка 6): снять сверку текста редактора перед `applyDelete` —
// краснеют кейсы 1, 2 и 4; снять сам вызов `applyDelete` — краснеет кейс 3.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { useContentStore } from '../../store/useContentStore';
import { applyDelete, applyWrite, getDraftGeneration, resolve, type DraftRecord } from '../draftWriter';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
const reportError = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/errors/reportError', () => ({ reportError }));

const TYPED = 'НАБИРАЕМОЕ_ДВ652';
const scene = vi.hoisted(() => ({
  cloudRow: null as Record<string, unknown> | null,
  typeDuringRead: false,
}));

// Момент «во время чтения»: первое обращение к базе внутри `resolve` подменяет
// буфер редактора — так правка приходит до того, как `resolve` решит удалять.
vi.mock('../../../../core/storage/localDb', async (importActual) => {
  const actual = await importActual<typeof import('../../../../core/storage/localDb')>();
  return {
    ...actual,
    getLocalDb: vi.fn(async (uid?: string | null) => {
      if (scene.typeDuringRead) {
        scene.typeDuringRead = false;
        useContentStore.getState().setContent(TYPED);
      }
      return actual.getLocalDb(uid ?? undefined);
    }),
  };
});

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => scene.cloudRow,
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => {},
  },
}));

const UID = 'u_dw652';
const GUEST = 'guest_dw652';
const GUEST_KEY = 'guest_draft';
const T0 = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const realNow = Date.now;

function draftOf(uid: string, content: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: uid, owner: uid, content, title: '', seconds: 10, wpm: 20, wordCount: 3,
    pinnedThoughts: [], tags: [], activeSessionId: null, savedDocumentId: null,
    sessionStartTime: null, updatedAt: T0, ...over,
  };
}

async function seed(uid: string, key: string, over: Record<string, unknown> = {}): Promise<void> {
  scene.typeDuringRead = false;
  const db = await getLocalDb(uid);
  // Ключ строки черновиков — `userId` (in-line key), поэтому он же и адрес:
  // аккаунт пишет под своим `uid`, гость — под `guest_draft`.
  await db.put('drafts', draftOf(key, 'УДАЛЁННЫЙ_ДВ652', { owner: uid, ...over }) as unknown as LocalDraft);
}

async function rowContent(uid: string, key: string): Promise<string | undefined> {
  scene.typeDuringRead = false;
  const db = await getLocalDb(uid);
  return ((await db.get('drafts', key)) as LocalDraft | undefined)?.content;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  vi.clearAllMocks();
  scene.cloudRow = null;
  scene.typeDuringRead = false;
  useContentStore.getState().setContent('');
  Date.now = () => T0;
});

afterEach(() => {
  Date.now = realNow;
  useContentStore.getState().setContent('');
});

describe('DW6-5.2: правка во время чтения лишает resolve права удалять', () => {
  it('просроченная строка, B печатает: строка цела, черновик не закрыт, запись набранного проходит', async () => {
    await seed(UID, UID, { updatedAt: T0 - 8 * DAY });
    const epochBefore = getDraftGeneration(UID);
    scene.typeDuringRead = true;

    const got = await resolve(UID);

    expect(got, 'просроченный черновик вернулся в редактор').toBeNull();
    expect(getDraftGeneration(UID), 'resolve поднял эпоху поверх новой печати').toBe(epochBefore);
    expect(await rowContent(UID, UID), 'просроченная строка снесена при набранном тексте').toBe('УДАЛЁННЫЙ_ДВ652');
    // Набранное обязано иметь адрес: та же эпоха, что у текста редактора.
    const outcome = await applyWrite(
      draftOf(UID, TYPED, { epoch: epochBefore }) as unknown as DraftRecord,
      'edit', { uid: UID, epoch: epochBefore },
    );
    expect(outcome, 'автосохранение отвергнуто: черновик закрыт удалением').toBe('written');
    expect(await rowContent(UID, UID)).toBe(TYPED);
  });

  it('надгробие по содержимому, B печатает: полного удаления нет', async () => {
    await seed(UID, UID);
    await applyDelete(UID, 'tombstone');
    await seed(UID, UID); // строка под тем же хэшем: её и находит надгробие
    const epochBefore = getDraftGeneration(UID);
    scene.typeDuringRead = true;

    const got = await resolve(UID);

    expect(got).toBeNull();
    expect(getDraftGeneration(UID), 'resolve закрыл черновик поверх новой печати').toBe(epochBefore);
    expect(await rowContent(UID, UID), 'надгробие снесло строку при набранном тексте').toBe('УДАЛЁННЫЙ_ДВ652');
  });

  it('без правки во время чтения удаление остаётся удалением', async () => {
    await seed(UID, UID, { updatedAt: T0 - 8 * DAY });
    const epochBefore = getDraftGeneration(UID);

    const got = await resolve(UID);

    expect(got).toBeNull();
    expect(getDraftGeneration(UID), 'просроченное не закрыло черновик — удаление не состоялось').toBe(epochBefore + 1);
    expect(await rowContent(UID, UID), 'просроченная строка осталась в базе').toBeUndefined();
  });

  it('гость: просроченная гостевая строка при набранном тексте остаётся', async () => {
    await seed(GUEST, GUEST_KEY, { updatedAt: T0 - 8 * DAY });
    const epochBefore = getDraftGeneration(GUEST);
    scene.typeDuringRead = true;

    const got = await resolve(GUEST, { guest: true });

    expect(got).toBeNull();
    expect(getDraftGeneration(GUEST), 'гостевое чтение подняло эпоху поверх новой печати').toBe(epochBefore);
    expect(await rowContent(GUEST, GUEST_KEY), 'просроченный гостевой черновик снесён при набранном тексте').toBe('УДАЛЁННЫЙ_ДВ652');
  });
});
