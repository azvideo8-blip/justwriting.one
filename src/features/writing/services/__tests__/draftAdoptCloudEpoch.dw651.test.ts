// DW6-5.1 (находка ревью 0.11.6): принятие облачной копии шло БЕЗ эпохи. Чтение
// облака занимает до 10 с; если в это время сохранена заметка (или черновик
// закрыли), эпоха поднята, а старая облачная копия всё равно ложилась в строку —
// набранное позже исчезало, а с другого прибора хэша под надгробием нет.
// В `resolve` эпоха снимается при начале чтения и называется записи: опоздавшее
// принятие отвергает мутатор (`stale-epoch`), а вызывающий получает локальную
// копию, а не чужой прошлый черновик.
// Мутация: убрать `epoch: readEpoch` из вызова `applyWrite(..., 'adopt-cloud')` —
// кейс «конец сессии» краснеет (строка перезаписана облаком).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { applySave, applySessionEnd, resolve } from '../draftWriter';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
const reportError = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/errors/reportError', () => ({ reportError }));

const cloud = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, saveDuringRead: false, sessionEndDuringRead: false }));

// Заметка сохраняется ровно в тот миг, когда облако ещё не ответило: так в тесте
// появляется настоящий подъём эпохи во время чтения, без таймеров и порядков.
function raiseEpochMidRead(): void {
  if (cloud.saveDuringRead) applySave(UID);
  if (cloud.sessionEndDuringRead) applySessionEnd(UID);
}

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => {
      await Promise.resolve();
      raiseEpochMidRead();
      return cloud.row;
    },
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => {},
  },
}));

const UID = 'u_dw651';
const T0 = 1_800_000_000_000;
const realNow = Date.now;

const LOCAL_TEXT = 'ЛОКАЛЬНОЕ_ДОНАБРАННОЕ_DW651';
const CLOUD_TEXT = 'ОБЛАКО_ПРОШЛОЕ_DW651';

async function seedRow(content: string): Promise<void> {
  const db = await getLocalDb(UID);
  await db.put('drafts', {
    userId: UID, owner: UID, content, title: '', seconds: 10, wpm: 20, wordCount: 3,
    pinnedThoughts: [], tags: [], activeSessionId: null, updatedAt: T0,
  } as unknown as LocalDraft);
}

async function rowText(): Promise<string | undefined> {
  const db = await getLocalDb(UID);
  return ((await db.get('drafts', UID)) as LocalDraft | undefined)?.content;
}

async function rowField<T>(field: string): Promise<T | undefined> {
  const db = await getLocalDb(UID);
  return ((await db.get('drafts', UID)) as unknown as Record<string, T> | undefined)?.[field];
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  vi.clearAllMocks();
  cloud.row = null;
  cloud.saveDuringRead = false;
  cloud.sessionEndDuringRead = false;
  Date.now = () => T0;
});

afterEach(() => {
  Date.now = realNow;
});

describe('DW6-5.1: принятие из облака обязано назвать эпоху чтения', () => {
  it('сохранение заметки во время чтения: облачная копия не перезаписывает строку', async () => {
    await seedRow(LOCAL_TEXT);
    // Облако новее по часам — без подъёма эпохи его бы приняли.
    cloud.row = {
      userId: UID, owner: UID, content: CLOUD_TEXT, title: '', seconds: 10, wpm: 20, wordCount: 3,
      pinnedThoughts: [], tags: [], activeSessionId: null, savedDocumentId: null,
      sessionStartTime: null, updatedAt: T0 + 120_000,
    };
    cloud.saveDuringRead = true;

    const got = await resolve(UID);

    expect(await rowText(), 'опоздавшее принятие затерло строку локальной копии').toBe(LOCAL_TEXT);
    // Ревьюер 04.11: прочитанная до сохранения копия — уже сохранённый текст.
    expect(got, 'сохранённый текст вернулся черновиком').toBeNull();
  });

  it('конец сессии во время чтения: принятие отвергнуто, ответ — локальная копия', async () => {
    await seedRow(LOCAL_TEXT);
    cloud.row = {
      userId: UID, owner: UID, content: CLOUD_TEXT, title: '', seconds: 10, wpm: 20, wordCount: 3,
      pinnedThoughts: [], tags: [], activeSessionId: null, savedDocumentId: null,
      sessionStartTime: null, updatedAt: T0 + 120_000,
    };
    cloud.sessionEndDuringRead = true;

    const got = await resolve(UID);

    expect(await rowText(), 'опоздавшее принятие затерло строку локальной копии').toBe(LOCAL_TEXT);
    expect(got?.content, 'вызывающему вернули прошлый черновик вместо локальной работы').toBe(LOCAL_TEXT);
  });

  it('ничего не случилось во время чтения: облачную копию принимают как раньше', async () => {
    await seedRow(LOCAL_TEXT);
    cloud.row = {
      userId: UID, owner: UID, content: CLOUD_TEXT, title: '', seconds: 10, wpm: 20, wordCount: 3,
      pinnedThoughts: [], tags: [], activeSessionId: null, savedDocumentId: null,
      sessionStartTime: null, updatedAt: T0 + 120_000,
    };

    const got = await resolve(UID);

    expect(got?.content).toBe(CLOUD_TEXT);
    expect(await rowText(), 'принятая копия не закеширована в строку').toBe(CLOUD_TEXT);
    // SF3-1: принятая версия запоминает свой штамп и свой хэш — иначе следующий
    // спор решили бы часы прибора.
    expect(await rowField<number>('_cloudUpdatedAt')).toBe(T0 + 120_000);
  });
});
