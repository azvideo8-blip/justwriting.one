// N1-4 (подозрение ревьюера, I1): при закрытии вкладки текст пишется синхронно в
// localStorage `draft-<uid>` (W14, `useDraftCore.ts:272-284`), а запись в IndexedDB
// в этот момент может не доделаться (отсрочка 500/1000 мс, обрыв транзакции).
// `loadDraft` выбирал локальную копию как `localDraft || legacyDraft`
// (`WritingDraftService.ts:439`): копия из localStorage читалась ТОЛЬКО когда
// строки IndexedDB нет совсем. Если в IndexedDB лежит черновик постарше, а в
// localStorage — новее, возвращался старый, а `clearLegacyDraft`
// (`useSessionPersistence.ts:109`) стирал ключ с новыми словами. Потеря окончательная.
// Мутация: вернуть `localDraft || legacyDraft` → кейсы «новое из localStorage
// восстанавливается» и «копия без даты…» красные (второй — потому что без строки
// IndexedDB выбор отдаёт копию, а с прежним `||` копия без даты читалась так же;
// краснеет ровно первый, см. отчёт).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { WritingDraftService } from '../WritingDraftService';

const realNow = Date.now;

const cloud = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => cloud.row,
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => { cloud.row = null; },
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

const UID = 'u_n1_unload';
const OTHER = 'u_n1_other';
// Фиксированная отметка в прошлом: просрочка (7 суток) и надгробие сверяются с
// часами, и живая дата сделала бы тест протухающим (поймано на AP2-4 в CI).
const T0 = 1_800_000_000_000;

function row(content: string, updatedAt: number, uid = UID): LocalDraft {
  return {
    userId: uid, owner: uid, title: '', content, seconds: 60, wpm: 40, wordCount: content.split(' ').length,
    pinnedThoughts: [], tags: [], activeSessionId: null, savedDocumentId: null, updatedAt,
  } as LocalDraft;
}

/** Как пишет W14 (`useDraftCore.ts:272-284`): снимок текста с `updatedAt: Date.now()`. */
function writeUnloadCopy(content: string, updatedAt: number, uid = UID): void {
  localStorage.setItem(STORAGE_KEYS.DRAFT(uid), JSON.stringify({
    content, title: '', seconds: 60, status: 'running', wordCount: content.split(' ').length,
    pinnedThoughts: [], sessionStartTime: null, activeSessionId: null, tags: [], updatedAt,
  }));
}

function readUnloadCopy(uid = UID): string | null {
  const raw = localStorage.getItem(STORAGE_KEYS.DRAFT(uid));
  if (!raw) return null;
  return (JSON.parse(raw) as { content?: string }).content ?? null;
}

/** Каждый тест обязан стартовать с чистых баз: строка `drafts` переживает
 *  `resetDbInstance()` и на следующем тесте решаёт спор вместо посева. */
async function dropDatabases(): Promise<void> {
  for (const name of ['justwriting-local', `justwriting-local-${UID}`, `justwriting-local-${OTHER}`]) {
    await new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  await dropDatabases();
  cloud.row = null;
  // Часы стоят на минуте раньше T0: ни TTL, ни временна́я ветка надгробия не
  // срабатывают сами по себе.
  Date.now = () => T0 - 60_000;
});

afterEach(() => { Date.now = realNow; });

describe('N1-4: из двух локальных копий берётся новая по updatedAt', () => {
  it('новое из localStorage восстанавливается, когда строка IndexedDB старее', async () => {
    await WritingDraftService.saveToLocal(row('раз', T0 - 10_000));
    writeUnloadCopy('раз два', T0);

    const restored = await WritingDraftService.loadDraft(UID);

    expect(restored?.content).toBe('раз два');
  });

  // Ревью N1 (02.11): снимок закрытия вкладки не несёт `savedDocumentId` и
  // счётчики. Без переноса со строки следующее «Сохранить» заводит вторую заметку
  // вместо версии (класс DW-F-2). Мутация: выключить перенос в `withCarriedFields` → красный.
  it('победившая копия забирает со строки номер продолженной заметки и счётчики', async () => {
    await WritingDraftService.saveToLocal({
      ...row('раз', T0 - 10_000), savedDocumentId: 'doc-n14', initialWordCount: 5, accumulatedDuration: 42,
    } as LocalDraft);
    writeUnloadCopy('раз два', T0);

    const restored = await WritingDraftService.loadDraft(UID);

    expect(restored?.content).toBe('раз два');
    expect(restored?.savedDocumentId).toBe('doc-n14');
    expect(restored?.initialWordCount).toBe(5);
    expect(restored?.accumulatedDuration).toBe(42);
  });

  it('строка IndexedDB остаётся, когда она новее копии', async () => {
    await WritingDraftService.saveToLocal(row('раз два три', T0));
    writeUnloadCopy('раз', T0 - 10_000);

    const restored = await WritingDraftService.loadDraft(UID);

    expect(restored?.content).toBe('раз два три');
  });

  it('копия без даты не вытесняет строку IndexedDB', async () => {
    await WritingDraftService.saveToLocal(row('раз два', T0));
    localStorage.setItem(STORAGE_KEYS.DRAFT(UID), JSON.stringify({ content: 'раз', seconds: 1 }));

    const restored = await WritingDraftService.loadDraft(UID);

    expect(restored?.content).toBe('раз два');
  });

  it('равные метки — побеждает строка IndexedDB (полная форма, не снимок вкладки)', async () => {
    await WritingDraftService.saveToLocal(row('раз два', T0));
    writeUnloadCopy('раз', T0);

    const restored = await WritingDraftService.loadDraft(UID);

    expect(restored?.content).toBe('раз два');
  });

  /**
   * Самопроверка (сверка 27): сравнивать можно только часы одного прибора. Строка
   * IndexedDB несёт СЕРВЕРНЫЙ штамп, когда копия была принята из облака
   * (`saveToLocal({...cloudDraft, _cloudUpdatedAt: cloudTs})`, и у такой копии
   * `updatedAt` = `draftCloudSeen` — признак D1-2). Копия закрытия вкладки всегда
   * штампится прибором. На приборе, который отстаёт от сервера, прежний выбор
   * «больше по числу» снова отдавал старую строку и терял последние слова —
   * то есть N1-4 работал только при точных часах.
   */
  it('отстающие часы: приборная копия берётся против серверной метки строки', async () => {
    // Строка базы принята из облака: её `updatedAt` — серверный штамп (0043),
    // и он же лежит в `_cloudUpdatedAt` — признак D1-2 «метку ставил не прибор».
    await WritingDraftService.saveToLocal({
      ...row('облачное', T0 + 300_000),
      _cloudUpdatedAt: T0 + 300_000,
    } as LocalDraft);
    // Копия закрытия вкладки штампуется прибором, а его часы отстают на 5 минут.
    writeUnloadCopy('облачное и последние слова', T0 - 300_000);

    const restored = await WritingDraftService.loadDraft(UID);

    expect(restored?.content, 'серверная метка обманула выбор: последние слова потеряны')
      .toBe('облачное и последние слова');
  });

  it('серверная метка строки и копия без даты — остаётся строка (угадывать дату нечем)', async () => {
    await WritingDraftService.saveToLocal({
      ...row('облачное', T0 + 300_000),
      _cloudUpdatedAt: T0 + 300_000,
    } as LocalDraft);
    localStorage.setItem(STORAGE_KEYS.DRAFT(UID), JSON.stringify({ content: 'старое без даты', seconds: 1 }));

    const restored = await WritingDraftService.loadDraft(UID);

    expect(restored?.content).toBe('облачное');
  });

  it('только копия в localStorage читается как раньше (адрес не потерялся)', async () => {
    writeUnloadCopy('раз два', T0);

    const restored = await WritingDraftService.loadDraft(UID);

    expect(restored?.content).toBe('раз два');
  });
});

describe('N1-4: то, чего правка не должна сломать', () => {
  it('I3: копия другого аккаунта не читается, даже когда она новее', async () => {
    await WritingDraftService.saveToLocal(row('раз', T0 - 10_000));
    writeUnloadCopy('чужие слова', T0 + 10_000, OTHER);

    const restored = await WritingDraftService.loadDraft(UID);

    expect(restored?.content).toBe('раз');
  });

  it('I2: сохранение стирает LS-ключ до чтения — выбирать старую копию не из чего', async () => {
    await WritingDraftService.saveToLocal(row('раз два', T0 - 10_000));
    writeUnloadCopy('раз два', T0);

    // D1/D4: `sessionActions.ts:44` → `deleteDraft` → `deleteDraftLocalPart`,
    // который снимает поколение и убирает `draft-<uid>`.
    await WritingDraftService.deleteDraft(UID);

    expect(readUnloadCopy()).toBeNull();
    expect(await WritingDraftService.loadDraft(UID)).toBeNull();
  });

  it('I5: надгробие по хэшу действует и на копию из localStorage', async () => {
    await WritingDraftService.saveToLocal(row('раз два', T0 - 10_000));
    writeUnloadCopy('раз два', T0);
    await WritingDraftService.deleteDraft(UID); // хэш удалённого содержимого — в надгробии

    // Копия вернулась в адрес (вторая вкладка, отказ removeItem) — та же строка,
    // что человек удалил.
    writeUnloadCopy('раз два', T0);

    expect(await WritingDraftService.loadDraft(UID)).toBeNull();
  });

  it('копия участвует в споре с облаком, а не обходит его', async () => {
    await WritingDraftService.saveToLocal(row('раз', T0 - 10_000));
    writeUnloadCopy('раз два', T0);
    cloud.row = { ...row('облачный текст', T0 + 300_000), userId: UID };

    const restored = await WritingDraftService.loadDraft(UID);

    // Облако заметно новее обеих локальных копий, о нём ничего не запомнено —
    // по часам выигрывает оно. Правило `decideDraftCopy` стоит НАД выбором
    // локальной копии, а не вместо него.
    expect(restored?.content).toBe('облачный текст');
  });
});
