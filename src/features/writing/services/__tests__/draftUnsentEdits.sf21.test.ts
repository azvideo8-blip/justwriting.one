import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance, LocalDraft } from '../../../../core/storage/localDb';
import { WritingDraftService, decideDraftCopy } from '../WritingDraftService';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { DataProvider } from '../../../../core/data';

// SF2-1 (ревью `sync-step0`, раунд 2): правка SF-2 перевела спор черновика на
// серверные метки — и открыла новый путь потери текста, которого на `main` нет.
//
// `decideDraftCopy` при запомненной метке отдаёт облако ВСЯКИЙ раз, когда его
// `updated_at` ушёл вперёд. А облако уходит вперёд и по ЗАПИСИ ЭТОГО ЖЕ
// устройства, ответ на которую потерянен: `DataProvider.saveDraft` бросает на
// `:330`, отметка `updated_at` не запомнена, но строка в облаке уже лежит.
// Человек продолжает писать (облако не трогает: дебаунс и 30 с), приложение
// перезапускается, и при загрузке «наша же» копия оказывается новее запомненной
// метки → побеждает → `saveToLocal` затирает всё, что было дописано после.
//
// То же между устройствами: A правит офлайн ПОСЛЕ того, как B сохранился раньше;
// при перезагрузке копия B заменяет более новый текст A.
//
// Правка: локальная копия хранит хэши последних ОТПРАВЛЕННЫХ в облако нагрузок и
// хэш последней ПРИНЯТОЙ. От них считаются два признака — «в локальной копии есть
// правки после принятого сохранения» и «облачная строка = наша же запись».
// Облако сдвинулось:
//   • хэш облачной строки есть в списке отправок → это дошла наша же запись,
//     ответа мы не видели → локальный текст новее по построению, он и остаётся;
//   • локальных правок после принятой записи нет → берём облако (как в SF-2);
//   • правки есть и облачное содержимое чужое → настоящий спор, прежнее
//     правило `main` (коридор 60 с по числу слов, иначе свежесть).
// Без хэшей (черновики до правки) — ровно то, что было в SF-2.

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
/**
 * Пользователь свой на каждый тест: `_lastCloudSignature` сервиса живёт в памяти
 * модуля между тестами одного файла, и второй тест с тем же id мог «уже
 * сохранить» первый текст, не доходя до записи.
 */
let UID = 'u_sf21_0';
let caseNo = 0;
/** Серверные часы идут на пять минут вперёд против часов этого прибора. */
let skew = 5 * MIN;

type DraftRow = Record<string, unknown> & { user_id: string; updated_at: string };

let drafts: DraftRow[];
let serverStamps: number[];
/** Следующая запись доходит до сервера, но ответ теряется. */
let loseNextResponse = false;
/** Облако недоступно: запрос не доходит, строка не меняется. */
let cloudDown = false;
/** Запись «в полёте»: применяется только по releaseInFlight(). */
let holdWrite = false;
/**
 * SF3-5: ряд `updated_at` пишет САМ клиент (так было до миграции 0043, и так
 * живёт новый клиент в окно «сначала клиент, миграция позже»). Метка comes из
 * нагрузки, а не с часов сервера — ровно та модель, на которой ранбук проверяет,
 * что новый клиент до 0043 не хуже `main`.
 */
let clientStamps = false;
let heldWrite: Record<string, unknown> | null = null;
/** Нагрузка последней upsert-записи — проверка, что служебные поля не уезжают. */
let lastPayload: Record<string, unknown> | null = null;

const serverNow = () => Date.now() + skew;
/** Метка ряда: часы сервера (с триггером 0043) или часы писавшего прибора (без него). */
function writeStamp(patch: Record<string, unknown>): number {
  if (!clientStamps) return serverNow();
  const raw = patch.updated_at;
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(String(raw ?? ''));
  return Number.isFinite(ms) ? ms : Date.now();
}
let releaseInFlight: (() => void) | null = null;
function releaseHeldWrite(): void {
  const run = releaseInFlight;
  releaseInFlight = null;
  if (!run) throw new Error('в полёте ничего не было — тест настроен неверно');
  run();
}

class Q {
  private f: Array<[string, unknown]> = [];
  private single = false;
  private projected: string | null = null;
  private ins: Record<string, unknown> | null = null;
  private del = false;

  constructor(private readonly table: string) {}

  select(cols?: string) { this.projected = cols ?? null; return this; }
  upsert(row: Record<string, unknown>) { this.ins = row; return this; }
  insert(row: Record<string, unknown>) { this.ins = row; return this; }
  update(patch: Record<string, unknown>) { this.ins = patch; return this; }
  delete() { this.del = true; return this; }
  eq(col: string, val: unknown) { this.f.push([col, val]); return this; }
  maybeSingle() { this.single = true; return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  like() { return this; }
  gt() { return this; }
  lt() { return this; }

  then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
    return this.run().then(onFulfilled, onRejected);
  }

  private match(r: DraftRow): boolean {
    return this.f.every(([col, val]) => (r as unknown as Record<string, unknown>)[col] === val);
  }

  private run(): Promise<{ data: unknown; error: unknown }> {
    if (this.table !== 'drafts') return Promise.resolve({ data: this.single ? null : [], error: null });

    if (this.ins) {
      if (cloudDown) return Promise.resolve({ data: null, error: new Error('cloud unavailable') });
      if (holdWrite) {
        heldWrite = { ...this.ins };
        // Промис висит, пока тест его не отпустит: запрос ушёл, ответа нет.
        return new Promise<{ data: unknown; error: unknown }>(resolve => {
          releaseInFlight = () => {
            holdWrite = false;
            const stamp = writeStamp(heldWrite as Record<string, unknown>);
            serverStamps.push(stamp);
            const row = this.applyWrite({ ...(heldWrite as Record<string, unknown>), updated_at: new Date(stamp).toISOString() });
            resolve({ data: this.single ? { updated_at: row.updated_at } : [row], error: null });
          };
        });
      }
      if (loseNextResponse) {
        loseNextResponse = false;
        // Запись СОВЕРШИЛАСЬ на сервере, ответа человек не увидел.
        const stamp = writeStamp(this.ins);
        serverStamps.push(stamp);
        this.applyWrite({ ...this.ins, updated_at: new Date(stamp).toISOString() });
        return Promise.resolve({ data: null, error: new Error('response lost after commit') });
      }
      const stamp = writeStamp(this.ins);
      serverStamps.push(stamp);
      const row = this.applyWrite({ ...this.ins, updated_at: new Date(stamp).toISOString() });
      const projection = this.projected === 'updated_at' ? { updated_at: row.updated_at } : row;
      return Promise.resolve({ data: this.single ? projection : [projection], error: null });
    }
    if (this.del) {
      drafts = drafts.filter(r => !this.match(r));
      return Promise.resolve({ data: null, error: null });
    }
    const hits = drafts.filter(r => this.match(r));
    if (!this.single) return Promise.resolve({ data: hits, error: null });
    const one = hits[0] ?? null;
    if (one && this.projected === 'updated_at') return Promise.resolve({ data: { updated_at: one.updated_at }, error: null });
    return Promise.resolve({ data: one, error: null });
  }

  /** upsert по первичному ключу: одна строка на аккаунт. */
  private applyWrite(patch: Record<string, unknown>): DraftRow {
    const uid = String(patch.user_id ?? UID);
    const previous = drafts.find(r => r.user_id === uid);
    const next: DraftRow = { ...(previous ?? {}), ...patch, user_id: uid } as DraftRow;
    lastPayload = { ...patch };
    drafts = drafts.filter(r => r.user_id !== uid);
    drafts.push(next);
    return next;
  }
}

vi.mock('../../../../core/supabase/client', () => ({
  getSupabase: () => ({ from: (table: string) => new Q(table), rpc: () => Promise.resolve({ data: null, error: null }) }),
}));

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  isProfileLoaded: () => true,
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

function draft(content: string, wordCount: number, updatedAt: number, extra: Partial<LocalDraft> = {}): LocalDraft {
  return {
    userId: UID, title: '', content, seconds: 60, wpm: 40, wordCount,
    pinnedThoughts: [], tags: [], activeSessionId: null, savedDocumentId: null,
    updatedAt, ...extra,
  };
}

async function stored(): Promise<Record<string, unknown> | undefined> {
  const db = await getLocalDb(UID);
  return await db.get('drafts', UID) as unknown as Record<string, unknown> | undefined;
}

const cloudRow = (): DraftRow | undefined => drafts.find(r => r.user_id === UID);
const sentMark = (): number => {
  const s = serverStamps.at(-1);
  if (s === undefined) throw new Error('сервер не ставил меток — тест настроен неверно');
  return s;
};

describe('SF2-1: облако сдвинулось по нашей же потерянной записи — локальный текст цел', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    UID = `u_sf21_${caseNo++}`;
    drafts = [];
    serverStamps = [];
    loseNextResponse = false;
    cloudDown = false;
    holdWrite = false;
    heldWrite = null;
    clientStamps = false;
    releaseInFlight = null;
    lastPayload = null;
    skew = 5 * MIN;
    localStorage.clear();
    sessionStorage.clear();
    resetDbInstance();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await (await getLocalDb(UID)).delete('drafts', UID);
    WritingDraftService.bumpDraftGeneration(UID);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDbInstance();
  });

  // Мутация: убрать ветку `cloudIsOurs` в `decideDraftCopy` (или не писать
  // `_cloudSentSig` до отправки) → этот тест красный: побеждает облачная копия
  // v2, а с ней `saveToLocal` затирает дописанное после v3.
  it('ответ на сохранение потерян, набор после него, перезапуск — текст цел', async () => {
    const v1 = draft('первый-набор', 3, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);
    const mark = sentMark();

    // Минуту спустя человек дописывает: запись доходит до сервера, ответ теряется.
    vi.setSystemTime(T0 + MIN);
    const v2 = draft('первый-набор и ещё', 6, T0 + MIN);
    await WritingDraftService.saveToLocal(v2);
    loseNextResponse = true;
    await expect(WritingDraftService.saveDraftToCloud(v2)).rejects.toThrow(/response lost/);
    expect(cloudRow()?.content, 'в облаке наша v2').toBe('первый-набор и ещё');
    expect(Number((await stored())?._cloudUpdatedAt), 'отвеченного штампа мы не видели — отметка прежняя').toBe(mark);

    // Набор продолжается, облако больше не берёт ничего.
    vi.setSystemTime(T0 + 2 * MIN);
    const v3 = draft('первый-набор и ещё плюс последние слова', 9, T0 + 2 * MIN);
    await WritingDraftService.saveToLocal(v3);
    cloudDown = true;
    await expect(WritingDraftService.saveDraftToCloud(v3)).rejects.toThrow(/cloud unavailable/);

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'облако ушло вперёд НАШЕЙ же записью — локальный текст не имеет права его затирать').toBe(v3.content);
    expect(String((await stored())?.content), 'и в локальном кэше').toBe(v3.content);

    const again = await WritingDraftService.loadDraft(UID);
    expect(again?.content, 'второй забор обязан дать то же самое').toBe(v3.content);
  });

  it('хэш последней отправки переживает отказ записи и не уезжает в облако', async () => {
    const v1 = draft('текст-одна', 2, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);
    const acked = (await stored())?._cloudAckedHash;
    expect(typeof acked, 'после принятой записи хэш обязан быть').toBe('string');
    expect((await stored())?._cloudSentHashes, 'принятая запись — она же последняя отправка').toEqual([acked]);

    const v2 = draft('текст-две', 4, T0 + MIN);
    await WritingDraftService.saveToLocal(v2);
    loseNextResponse = true;
    await expect(WritingDraftService.saveDraftToCloud(v2)).rejects.toThrow(/response lost/);

    const marked = await stored();
    expect(marked?._cloudSentHashes, 'отправка зафиксирована до ответа — иначе свою копию примем за чужую').toHaveLength(2);
    expect(marked?._cloudAckedHash, 'ответ не пришёл — v2 не стала принятой базой').toBe(acked);
    expect(marked?.content, 'фиксация отправки не имеет права откатить текст').toBe('текст-две');
    expect(lastPayload, 'служебные поля не уезжают в облако').not.toHaveProperty('_cloudSentHashes');
    expect(lastPayload, 'хэш принятой версии тоже остаётся дома').not.toHaveProperty('_cloudAckedHash');
    expect(lastPayload, 'метка прибора тоже остаётся дома').not.toHaveProperty('_cloudUpdatedAt');
  });

  it('чужая запись впереди, локальный черновик без правок — облако приезжает', async () => {
    const v1 = draft('первый-набор', 3, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);
    const acked = (await stored())?._cloudAckedHash;

    // Другое устройство выгрузило СВОЁ содержимое; локальных правок после отправки нет.
    vi.setSystemTime(T0 + 3 * MIN);
    await DataProvider.saveDraft(UID, { userId: UID, content: 'с-другого-устройства', title: null, wordCount: 30, pinnedThoughts: [], tags: [] });

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'локальных правок нет — облако новее, оно побеждает').toBe('с-другого-устройства');
    expect(Number((await stored())?._cloudUpdatedAt), 'принятая копия запоминает метку').toBe(sentMark());
    expect(String((await stored())?._cloudAckedHash), 'принятая копия становится нашей базой').not.toBe(acked);
    expect(/^[0-9a-f]{16}$/.test(String((await stored())?._cloudAckedHash)), 'базой становится хэш, а не текст').toBe(true);
  });

  it('настоящий спор: A правил офлайн после записи B — побеждает свежесть, как на main', async () => {
    // Часы сверены: в этом исходе сравнивать свежесть имеет смысл, и ровно так
    // же сравнивает `main`. Дальше по тексту — тот же исход при отставании часов.
    skew = 0;
    const v1 = draft('первый-набор', 3, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);

    // B выкладывает свою версию.
    vi.setSystemTime(T0 + MIN);
    await DataProvider.saveDraft(UID, { userId: UID, content: 'чужой-короткий', title: null, wordCount: 1, pinnedThoughts: [], tags: [] });

    // A правил офлайн ПОСЛЕ этого — его локальный штамп новее.
    vi.setSystemTime(T0 + 4 * MIN);
    const aEdit = draft('мой-длинный-набор-после-чужой-записи', 12, T0 + 4 * MIN);
    await WritingDraftService.saveToLocal(aEdit);

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'локальная правка свежее чужой записи — правило main оставляет её').toBe(aEdit.content);
  });

  it('настоящий спор: чужая запись свежее — приезжает она, как на main', async () => {
    skew = 0;
    const v1 = draft('первый-набор', 3, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);

    // A правит офлайн, потом B сохраняет СВОЁ (по времени позже правки A).
    vi.setSystemTime(T0 + MIN);
    await WritingDraftService.saveToLocal(draft('мой-набор', 4, T0 + MIN));
    vi.setSystemTime(T0 + 3 * MIN);
    await DataProvider.saveDraft(UID, { userId: UID, content: 'чужой-свежее', title: null, wordCount: 40, pinnedThoughts: [], tags: [] });

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'правка другого устройства новее нашей — правило main отдаёт облако').toBe('чужой-свежее');
  });

  // SF3-1 (ревью, раунд 3): потолок в 4 отправки — это четыре падения подряд, а
  // на плохой сети их бывает больше. Хэш ДОШЕДШЕЙ записи (ответ потерян) вытесняется
  // старшим, и при перезапуске облако уже не «наше» → спор судят часы → на отстающем
  // приборе облако затирает набранное. На `main` локальная копия побеждает.
  // Мутация: вернуть потолок 4 (SENT_HASH_CAP) → красный (текст затёрт своей же
  // дошедшей версией).
  it('четыре падения после потерянного ответа не вытесняют хэш дошедшей записи (SF3-1)', async () => {
    skew = 10 * MIN;
    const v1 = draft('первый-набор', 3, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);

    vi.setSystemTime(T0 + MIN);
    const v2 = draft('первый-набор и ещё', 6, T0 + MIN);
    await WritingDraftService.saveToLocal(v2);
    loseNextResponse = true;
    await expect(WritingDraftService.saveDraftToCloud(v2)).rejects.toThrow(/response lost/);
    expect(cloudRow()?.content, 'дошедшая запись — она же').toBe('первый-набор и ещё');

    // Набор продолжается, облако не берёт ничего ещё четырежды (~2,5 мин подряд).
    cloudDown = true;
    const versions = [
      draft('первый-набор и ещё плюс', 8, T0 + 2 * MIN),
      draft('первый-набор и ещё плюс абзац', 10, T0 + 3 * MIN),
      draft('первый-набор и ещё плюс абзац и заголовок', 12, T0 + 4 * MIN),
      draft('первый-набор и ещё плюс абзац, заголовок и конец', 14, T0 + 5 * MIN),
    ];
    for (const v of versions) {
      await WritingDraftService.saveToLocal(v);
      await expect(WritingDraftService.saveDraftToCloud(v)).rejects.toThrow(/cloud unavailable/);
    }

    const row = await stored();
    expect((row?._cloudSentHashes as unknown[] | undefined) ?? [], 'ни одна неотправленная нагрузка не вытеснена')
      .toHaveLength(6);

    const last = versions[versions.length - 1]!;
    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'облако держит нашу дошедшую запись — локальный набор цел').toBe(last.content);
    expect(String((await stored())?.content), 'и в локальном кэше').toBe(last.content);
  });

  // SF3-1: список означает «уехало и ответа мы не видели». Принятая запись закрывает
  // все прежние неотправленные: они либо лежат в облаке под ней, либо никогда туда
  // не попали, и держаться за них больше не за чем (растущий список — это и вытеснение,
  // и ложные «наше» в будущем).
  // Мутация: не сбрасывать список на принятом сохранении → красный (4 хэша вместо 1).
  it('принятое сохранение закрывает список неотправленных (SF3-1)', async () => {
    const v1 = draft('текст-одна', 2, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);

    cloudDown = true;
    for (const at of [1, 2]) {
      const v = draft(`текст-одна и ещё ${at}`, 4 + at, T0 + at * MIN);
      await WritingDraftService.saveToLocal(v);
      await expect(WritingDraftService.saveDraftToCloud(v)).rejects.toThrow(/cloud unavailable/);
    }
    expect((await stored())?._cloudSentHashes, 'неотправленные копятся').toHaveLength(3);

    cloudDown = false;
    const v3 = draft('текст-одна и ещё 1 2 и принято', 9, T0 + 3 * MIN);
    await WritingDraftService.saveToLocal(v3);
    await WritingDraftService.saveDraftToCloud(v3);

    const row = await stored();
    expect(row?._cloudSentHashes, 'принятая запись — список из неё одной').toEqual([row?._cloudAckedHash]);
    expect((row?._cloudSentHashes as unknown[]).length, 'и он не пустой').toBe(1);
  });

  it('без запомненных хэшей правило SF-2 не меняется', async () => {
    // Черновик, написанный до правки: метка есть, хэшей отправок нет.
    await WritingDraftService.saveToLocal(draft('локальный', 5, T0));
    await WritingDraftService.saveDraftToCloud(draft('локальный', 5, T0));
    const before = await stored();
    delete before?._cloudAckedHash;
    delete before?._cloudSentHashes;
    const db = await getLocalDb(UID);
    await db.put('drafts', before as unknown as LocalDraft);

    vi.setSystemTime(T0 + 3 * MIN);
    await DataProvider.saveDraft(UID, { userId: UID, content: 'облачное', title: null, wordCount: 9, pinnedThoughts: [], tags: [] });

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'не знаем, чьё облако и есть ли локальные правки — поведение SF-2').toBe('облачное');
  });
});

describe('SF2-6: страж удалённого черновика не судит часы прибора с меткой сервера', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    UID = `u_sf26_${caseNo++}`;
    drafts = [];
    serverStamps = [];
    loseNextResponse = false;
    cloudDown = false;
    holdWrite = false;
    heldWrite = null;
    clientStamps = false;
    releaseInFlight = null;
    lastPayload = null;
    skew = 5 * MIN;
    localStorage.clear();
    sessionStorage.clear();
    resetDbInstance();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await (await getLocalDb(UID)).delete('drafts', UID);
    WritingDraftService.bumpDraftGeneration(UID);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDbInstance();
  });

  // Мутация: вернуть прежнюю единственную сверку `(toTimestampMs(x.updatedAt) ?? 0)
  // <= deletedAt` и не хранить хэш удалённого содержимого → красный первый тест
  // (удалённый черновик возвращается), красный и второй с другой стороны — если
  // вместо хэша удаляемого текста сверять «всякое облачное новее удаления».
  it('сохранение в полёте, пришедшее после удаления, не воскрешает черновик', async () => {
    const v1 = draft('текст-до-удаления', 4, T0);
    await WritingDraftService.saveToLocal(v1);

    // Отправка ушла до удаления и «висит»: сервер примет её позже.
    holdWrite = true;
    const inflight = WritingDraftService.saveDraftToCloud(v1);
    // Дать запросу дойти до билдера: шифрование — несколько микротasks.
    for (let i = 0; i < 6; i++) await new Promise(res => setTimeout(res, 0));
    expect(releaseInFlight, 'запись ушла в полёт').not.toBeNull();

    // Человек удаляет черновик (часы прибора отстают от серверных на пять минут).
    vi.setSystemTime(T0 + MIN);
    await WritingDraftService.deleteDraft(UID);
    expect(sessionStorage.getItem(STORAGE_KEYS.DRAFT_DELETED(UID)), 'метка удаления стоит')
      .toContain(String(T0 + MIN).slice(0, 10));

    releaseHeldWrite();
    await expect(inflight).resolves.toBeDefined();
    expect(cloudRow()?.content, 'облако приняло нашу же уехавшую запись').toBe('текст-до-удаления');

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded, 'удалённый черновик не возвращается при перезагрузке').toBeNull();
    expect(cloudRow(), 'и ряд в облаке снесён повторно').toBeUndefined();
  });

  // SF3-4 (ревью, раунд 3): отметка удаления держала хэш ТОГО, что лежало в
  // локальной строке в момент удаления. Сохранение, ушедшее раньше, чем человек
  // дописал и удалил черновик, везёт в облако ДРУГУЮ версию — её хэша в отметке
  // нет, а серверная метка позже удаления. Воскрешение при любых часах, в случае,
  // который main держит (там метка ряда — приборная и старшая за удаление).
  // Мутация: хэш только текущей строки → красный (облачная v1 возвращается).
  // Мутация: собрать отметку только из ХЭША ТЕКУЩЕЙ строки (`new Set([draftPayloadHash(row)])`)
  // → красный «…в полёте доехала более ранняя версия — она тоже удалена»; тот же
  // красный у прежнего SF2-6 кода, где хэш был один и брался до дописки.
  it('удаление после дописки: в полёте доехала более ранняя версия — она тоже удалена (SF3-4)', async () => {
    skew = 0;
    const v1 = draft('текст-в-полёте', 4, T0);
    await WritingDraftService.saveToLocal(v1);

    holdWrite = true;
    const inflight = WritingDraftService.saveDraftToCloud(v1);
    for (let i = 0; i < 6; i++) await new Promise(res => setTimeout(res, 0));
    expect(releaseInFlight, 'запись ушла в полёт').not.toBeNull();

    // Человек дописывает — локальная строка меняется, а след уехавшей нагрузки
    // обязан пережить эту правку.
    vi.setSystemTime(T0 + 30_000);
    const v2 = draft('текст-в-полёте и дописано', 7, T0 + 30_000);
    await WritingDraftService.saveToLocal(v2);
    expect((await stored())?._cloudSentHashes, 'след неотправленной нагрузки живёт в строке').toHaveLength(1);

    // …и удаляет черновик.
    vi.setSystemTime(T0 + MIN);
    await WritingDraftService.deleteDraft(UID);
    const mark = sessionStorage.getItem(STORAGE_KEYS.DRAFT_DELETED(UID)) ?? '';
    expect(mark.split('|')[1] ?? '', 'отметка удаления называет больше одного хэша').toContain(',');

    // Ответ доходит через две секунды ПОСЛЕ удаления — серверная метка позже него.
    vi.setSystemTime(T0 + MIN + 2000);
    releaseHeldWrite();
    await expect(inflight).resolves.toBeDefined();
    expect(cloudRow()?.content, 'в облако легла ровно та версия, что была в полёте').toBe('текст-в-полёте');

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded, 'удалённая версия не возвращается ни при каких часах').toBeNull();
    expect(cloudRow(), 'и ряд в облаке снесён').toBeUndefined();
  });

  it('свежая чужая запись после удаления остаётся: это не воскрешение', async () => {
    const v1 = draft('текст-до-удаления', 4, T0);
    await WritingDraftService.saveToLocal(v1);
    vi.setSystemTime(T0 + MIN);
    await WritingDraftService.deleteDraft(UID);

    // Другое устройство после этого пишет СВОЙ новый черновик.
    vi.setSystemTime(T0 + 3 * MIN);
    await DataProvider.saveDraft(UID, { userId: UID, content: 'новый-с-другого-устройства', title: null, wordCount: 7, pinnedThoughts: [], tags: [] });

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'содержимое не совпадает с удалённым — это новая работа, её отдаём').toBe('новый-с-другого-устройства');
  });
});

describe('SF3-5: новый клиент ДО миграции 0043 эквивалентен main', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    UID = `u_sf35_${caseNo++}`;
    drafts = [];
    serverStamps = [];
    loseNextResponse = false;
    cloudDown = false;
    holdWrite = false;
    heldWrite = null;
    // Ранбук выкатки: сначала клиент, 0043 — через несколько дней. В это окно
    // метку ряда пишет САМ прибор (`updatedAt: new Date()` в провайдере), триггера
    // на сервере нет.
    clientStamps = true;
    releaseInFlight = null;
    lastPayload = null;
    skew = 0;
    localStorage.clear();
    sessionStorage.clear();
    resetDbInstance();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await (await getLocalDb(UID)).delete('drafts', UID);
    WritingDraftService.bumpDraftGeneration(UID);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDbInstance();
  });

  /**
   * Правило `main` дословно (`git show origin/main:…/WritingDraftService.ts`,
   * строки 149-155): коридор 60 с по числу слов, иначе свежесть. Сверяем исход
   * новым правилом, а не памятью о нём.
   */
  const byMain = (localTs: number, localWords: number, cloudTs: number, cloudWords: number): 'local' | 'cloud' =>
    Math.abs(localTs - cloudTs) < 60_000
      ? (localWords >= cloudWords ? 'local' : 'cloud')
      : (localTs > cloudTs ? 'local' : 'cloud');

  // Мутация: вернуть прежнее правило SF-2 (`if (o.cloudTs > o.cloudSeen) return 'cloud'`
  // до сверки отправок и без `localDirty`) → красны обе ветки: недошедшая правка
  // отдаётся облаку, а принятая копия не запоминается.
  it('прибор спешит, в локальной копии есть недошедшая правка — остаётся локал, как на main', async () => {
    const v1 = draft('первый-набор', 3, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);
    const accepted = await stored();
    expect(accepted?._cloudUpdatedAt, 'метка принятой версии — часы писавшего прибора (триггера ещё нет)').toBe(T0);
    expect(accepted?._cloudSentHashes, 'хэш отправки в локальной копии есть ДО 0043').toBeDefined();
    expect(accepted?._cloudAckedHash, 'и хэш принятой — то есть к моменту 0043 черновик уже не «без хэшей»').toBeDefined();

    // Часы другого прибора спешат: его запись ставит ряду ЕГО время.
    vi.setSystemTime(T0 + 2 * MIN);
    await DataProvider.saveDraft(UID, { userId: UID, content: 'чужой-набор', title: null, wordCount: 30, pinnedThoughts: [], tags: [] });
    const cloudTs = T0 + 2 * MIN;

    // Это устройство пишет дальше; его локальный штамп — часы прибора, они впереди.
    vi.setSystemTime(T0 + 5 * MIN);
    const mine = draft('мой-набор-после-чужой-записи', 40, T0 + 5 * MIN);
    await WritingDraftService.saveToLocal(mine);

    expect(byMain(T0 + 5 * MIN, 40, cloudTs, 30), 'на main этот исход — локал').toBe('local');
    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'новый клиент без триггера даёт тот же исход и ничего не теряет').toBe(mine.content);
  });

  it('недошедших правок нет, облако новее — копия приезжает (на main она зависала)', async () => {
    const v1 = draft('первый-набор', 3, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);

    vi.setSystemTime(T0 + 2 * MIN);
    await DataProvider.saveDraft(UID, { userId: UID, content: 'чужой-набор', title: null, wordCount: 30, pinnedThoughts: [], tags: [] });

    // Прибор спешит: локальный штамп принятой копии (T0) отстаёт от чужого (T0+2 мин),
    // и main по свежести оставил бы СВОЮ, уже принятую копию навечно.
    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'правилу main тут судить нечем: локальная копия = последняя принятая').toBe('чужой-набор');
    const stored2 = await stored();
    expect(stored2?._cloudSentHashes, 'принятая чужая копия закрывает список отправок').toEqual([stored2?._cloudAckedHash]);
    expect(stored2?._cloudUpdatedAt, 'и запоминает метку ряда').toBe(T0 + 2 * MIN);
  });

  // Мутация: `if (o.localDirty === true) return byClock();` → красный первый
  // случай таблицы (недошедшая правка при своих спешащих часах уходит облаку).
  it('таблица исходов: там, где есть недошедшая правка, решение = правило main', () => {
    const stamps = [0, 30_000, 61_000, 5 * MIN];
    const words = [1, 5, 40];
    let checked = 0;
    for (const cloudSeen of [null, 10 * MIN]) {
      for (const cloudDelta of stamps) {
        for (const localDelta of stamps) {
          for (const localWords of words) {
            for (const cloudWords of words) {
              const cloudTs = 20 * MIN + cloudDelta;
              const localTs = 20 * MIN + localDelta;
              const main = byMain(localTs, localWords, cloudTs, cloudWords);
              // Недошедшая правка есть, облако чужое → новое правило обязано дать
              // ровно то же, что main. Облако своё — локал всегда (это лучше main).
              const got = decideDraftCopy({
                cloudSeen, cloudTs, localTs, localWords, cloudWords,
                cloudIsOurs: false, localDirty: true,
              });
              expect(got, `cloudSeen=${cloudSeen} cloudTs=${cloudTs} localTs=${localTs} words=${localWords}/${cloudWords}`).toBe(main);
              checked++;
              if (cloudSeen !== null && cloudTs <= cloudSeen) {
                expect(decideDraftCopy({ cloudSeen, cloudTs, localTs, localWords, cloudWords, cloudIsOurs: true, localDirty: true }),
                  'своя же запись в облаке не имеет права затирать локал при любых часах').toBe('local');
              }
            }
          }
        }
      }
    }
    expect(checked, 'комбинаций проверено').toBeGreaterThan(200);
  });
});

describe('SF2-1: правило целиком', () => {
  it('облако впереди: наша же запись → локал; правок нет → облако; правки есть и облако чужое → правило main', () => {
    // Облако не уходило вперёд — прежняя ветка SF-2.
    expect(decideDraftCopy({ cloudSeen: 100, cloudTs: 100, localTs: 1, localWords: 1, cloudWords: 999 })).toBe('local');

    // Наша потерянная по ответу запись: содержимое облака = одна из последних отправок.
    expect(decideDraftCopy({
      cloudSeen: 100, cloudTs: 200, localTs: 300, localWords: 9, cloudWords: 6,
      cloudIsOurs: true, localDirty: true,
    })).toBe('local');
    expect(decideDraftCopy({
      cloudSeen: 100, cloudTs: 200, localTs: 5, localWords: 9, cloudWords: 6,
      cloudIsOurs: true, localDirty: true,
    }), 'часы прибора отстают — своя же запись в облаке всё равно не имеет права затирать локал').toBe('local');

    // Правок после принятой записи нет: берём облако (как SF-2).
    expect(decideDraftCopy({
      cloudSeen: 100, cloudTs: 200, localTs: 5, localWords: 1, cloudWords: 999,
      cloudIsOurs: false, localDirty: false,
    })).toBe('cloud');

    // Настоящий спор — прежнее правило: коридор 60 с по числу слов, иначе свежесть.
    expect(decideDraftCopy({
      cloudSeen: 100, cloudTs: 500, localTs: 480, localWords: 5, cloudWords: 3,
      cloudIsOurs: false, localDirty: true,
    })).toBe('local');
    expect(decideDraftCopy({
      cloudSeen: 100, cloudTs: 500, localTs: 480, localWords: 3, cloudWords: 5,
      cloudIsOurs: false, localDirty: true,
    })).toBe('cloud');
    expect(decideDraftCopy({
      cloudSeen: 100, cloudTs: 500_000, localTs: 400, localWords: 99, cloudWords: 1,
      cloudIsOurs: false, localDirty: true,
    })).toBe('cloud');

    // Признаков нет — поведение SF-2: облако впереди, значит облако.
    expect(decideDraftCopy({ cloudSeen: 100, cloudTs: 101, localTs: 10_000, localWords: 1, cloudWords: 1 })).toBe('cloud');

    // Метки нет (переходный путь): часы прибора, но своя запись в облаке спасает и тут.
    expect(decideDraftCopy({
      cloudSeen: null, cloudTs: 900_000, localTs: 400, localWords: 9, cloudWords: 6,
      cloudIsOurs: true, localDirty: true,
    })).toBe('local');
    expect(decideDraftCopy({ cloudSeen: null, cloudTs: 500_000, localTs: 400, localWords: 1, cloudWords: 1 })).toBe('cloud');
    expect(decideDraftCopy({ cloudSeen: null, cloudTs: 500, localTs: 480, localWords: 5, cloudWords: 3 })).toBe('local');
  });
});
