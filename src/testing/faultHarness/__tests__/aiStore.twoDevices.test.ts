import { describe, it, expect, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import { Device, activeDevice, forgetDevice, activateDevice } from '../harnessDevice';
import { getLocalDb, AIChatMemory } from '../../../core/storage/localDb';
import { journalKeyFor } from '../../../core/sync/syncJournal';
import {
  LocalStoreSyncManager,
  getDeadStoreUpserts,
  getLocalStoreSyncSummary,
  getPendingUpsertKeySet,
  MAX_LOCAL_RECORD_BYTES,
  PAGE_SPLIT_THRESHOLD_BYTES,
  _resetReportedForTests,
} from '../../../core/services/LocalStoreSyncService';
import { DataProvider } from '../../../core/data';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';

/**
 * SF2-4 (ревью `sync-step0`, раунд 2): стенд двух устройств не покрывал
 * `local_store_records`. Ни `LocalStoreSyncService`, ни `restoreAIDataFromCloud`
 * в его цикле не стояли, а в in-memory Postgres у ряда не было серверной метки
 * `stamped_at` — того самого числа, на котором держатся CAS выгрузки скаляра и
 * инкрементальный забор ИИ-данных. Поэтому правки SF-1…SF-6 проверялись
 * самописными фейками PostgREST, и класс находок, который виден только между
 * двумя устройствами во времени (SF2-2), стенду был невиден.
 *
 * Здесь — перенос S0-7: метка сервера в харнесе, оба боевым циклом
 * (выгрузка менеджером записей + `restoreAIDataFromCloud`), инварианты I1–I6
 * для ИИ-данных и сценарии, названные в тикете. Устройства работают ОДНИМ И ТЕМ ЖЕ
 * кодом приложения: `LocalStoreSyncManager` — по экземпляру на вкладку (очередь
 * живёт в памяти вкладки, журнал — в localStorage устройства), запись в
 * IndexedDB и планирование отправки — как у писателя `AIChatMemoryService`.
 *
 * Сценарий «перештамповка ряда без смены содержимого» («зашифровать всё» /
 * «отправить всё» на другом устройстве) сюда не входит: он красный на текущем
 * коде — это приёмка SF2-2, и он едет в том же коммите, что и правка.
 */

const STORE = 'aiChatMemory';

type Mem = AIChatMemory & { _cloudStampedAt?: number };

function memory(id: string, text: string, at: number): Mem {
  return { id, kind: 'fact', text, sourceDialogueId: 'stand', createdAt: at, updatedAt: at };
}

/** Запись «как писатель»: локальная строка + обязательство выгрузить. */
async function putMemory(dev: Device, uid: string, id: string, text: string, at: number): Promise<void> {
  const db = await getLocalDb(uid);
  await db.put(STORE, memory(id, text, at));
  managerOf(dev).scheduleStoreSync(STORE, id);
}

async function deleteMemory(dev: Device, uid: string, id: string): Promise<void> {
  const db = await getLocalDb(uid);
  await db.delete(STORE, id);
  managerOf(dev).scheduleStoreDelete(STORE, id);
}

/** Один менеджер на устройство: очередь вкладки ≠ чужая очередь. */
const managers = new Map<Device, LocalStoreSyncManager>();
function managerOf(dev: Device): LocalStoreSyncManager {
  let m = managers.get(dev);
  if (!m) {
    m = new LocalStoreSyncManager();
    managers.set(dev, m);
  }
  return m;
}

async function localMemories(uid: string): Promise<Map<string, string>> {
  const db = await getLocalDb(uid);
  const out = new Map<string, string>();
  for (const m of (await db.getAll(STORE)) as Mem[]) out.set(m.id, m.text);
  return out;
}

/** Снимок активного устройства: его строки и его же обязательства. */
async function snapshot(uid: string): Promise<{
  local: Map<string, string>;
  pendingKeys: Set<string> | null;
  dead: Set<string>;
}> {
  return {
    local: await localMemories(uid),
    pendingKeys: getPendingUpsertKeySet(uid),
    dead: new Set(getDeadStoreUpserts(uid).map(d => d.key)),
  };
}

/** Облачные ряды этого стора: базовая строка и страницы `id#N`. */
function cloudRows(): Array<{ key: string; data: string; stamped_at?: unknown }> {
  return managerRows().map(r => ({
    key: String(r.key),
    data: String((r.payload as { data?: unknown })?.data ?? ''),
    stamped_at: r.stamped_at,
  }));
}

function managerRows(): Array<Record<string, unknown>> {
  return pg().getRows('local_store_records').filter(r => r.store === STORE);
}

/** Текст базовой строки (постраничная запись им не является). */
function cloudText(id: string): string | undefined {
  const row = cloudRows().find(r => r.key === id);
  if (!row) return undefined;
  try {
    return String((JSON.parse(row.data) as { text?: unknown }).text ?? '');
  } catch {
    return undefined;
  }
}

let runnerRef: LifecycleRunner | null = null;
function pg() {
  if (!runnerRef) throw new Error('стенд не поднят');
  return runnerRef.interceptor.postgres;
}

/** История серверных меток ряда — для I4 (монотонность отметки). */
const stampHistory = new Map<string, number[]>();
/** Объект Postgres у раннера один на все тесты: обёртку ставим ровно один раз. */
const watched = new WeakSet<object>();
function watchServerStamps(): void {
  if (!runnerRef) throw new Error('стенд не поднят');
  const postgres = runnerRef.interceptor.postgres;
  if (watched.has(postgres)) return;
  watched.add(postgres);
  const wrap = (name: 'executeInsert' | 'executeUpsert' | 'executeUpdate') => {
    const original = postgres[name].bind(postgres);
    postgres[name] = ((...args: unknown[]) => {
      const res = (original as (...a: unknown[]) => ReturnType<typeof original>)(...args);
      if (args[0] === 'local_store_records') {
        // Один запрос = одна метка на строку: страницы пишутся массивом в одном
        // обращении, и повтор той же метки внутри запроса нарушением порядка
        // не считается.
        const perKey = new Map<string, number>();
        for (const row of res.data ?? []) {
          const key = `${row.store}:${row.key}`;
          const stamp = Date.parse(String(row.stamped_at));
          if (Number.isFinite(stamp)) perKey.set(key, stamp);
        }
        for (const [key, stamp] of perKey) {
          const hist = stampHistory.get(key) ?? [];
          hist.push(stamp);
          stampHistory.set(key, hist);
        }
      }
      return res;
    }) as typeof postgres.executeInsert;
  };
  for (const name of ['executeInsert', 'executeUpsert', 'executeUpdate'] as const) wrap(name);
}

/** Что лежит на другом устройстве, без смены «активной вкладки» для теста. */
async function peekLocal(dev: Device, uid: string): Promise<Map<string, string>> {
  const active = activeDevice();
  if (active === dev) return await localMemories(uid);
  activateDevice(dev);
  const out = await localMemories(uid);
  if (active) activateDevice(active);
  return out;
}

/**
 * Раунд синка ИИ-данных: дренаж очереди этим устройством и забор изменений
 * сервера (`sinceMs: 0` — полный проход, но по той же ветке инкрементального
 * забора по `stamped_at`; эмбеддинги он не трогает).
 */
async function aiSyncRound(dev: Device, uid: string): Promise<void> {
  await managerOf(dev).flushPending();
  await restoreAIDataFromCloud(uid, { sinceMs: 0 });
}

async function converge(devs: Device[], uid: string, rounds = 3): Promise<void> {
  for (const dev of devs) activateDevice(dev);
  for (let i = 0; i < rounds; i++) {
    for (const dev of devs) {
      activateDevice(dev);
      await aiSyncRound(dev, uid);
    }
  }
}

describe('SF2-4: ИИ-данные на стенде двух устройств', () => {
  const runner = new LifecycleRunner();
  let online = true;

  async function boot(devs: Device[]): Promise<string> {
    runnerRef = runner;
    online = true;
    managers.clear();
    stampHistory.clear();
    _resetReportedForTests();
    activateDevice(devs[0]!);
    await runner.setup();
    watchServerStamps();
    for (const dev of devs) dev.storage.set('auto_sync_enabled', 'true');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    return runner.userId;
  }

  afterEach(() => {
    runner.teardown();
    runnerRef = null;
    managers.clear();
    forgetDevice();
    vi.restoreAllMocks();
  });

  it('метка сервера стоит на каждом ряду и не убывает (I4)', async () => {
    const A = new Device('A'), B = new Device('B');
    const uid = await boot([A, B]);

    activateDevice(A);
    await putMemory(A, uid, 'm1', 'первая версия', 1000);
    await aiSyncRound(A, uid);
    activateDevice(B);
    await aiSyncRound(B, uid);
    activateDevice(A);
    await putMemory(A, uid, 'm1', 'вторая версия', 2000);
    await aiSyncRound(A, uid);
    await converge([A, B], uid);

    const rows = managerRows();
    expect(rows.length, 'ряд в облаке есть').toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.stamped_at, `ряду ${row.key} сервер поставил метку`).toBe('string');
    }
    const hist = stampHistory.get(`${STORE}:m1`) ?? [];
    expect(hist.length, 'выгрузка и перештамповка — не менее двух меток').toBeGreaterThanOrEqual(2);
    for (let i = 1; i < hist.length; i++) {
      expect(hist[i]! > hist[i - 1]!, `метка ряда m1 обязана расти: ${hist.join(' → ')}`).toBe(true);
    }
    expect((await localMemories(uid)).get('m1'), 'оба устройства сошлись на последней версии').toBe('вторая версия');
  });

  it('запись больше потолка не уезжает и не стирается забором (SF-1, SF-3)', async () => {
    const A = new Device('A'), B = new Device('B');
    const uid = await boot([A, B]);
    const huge = 'x'.repeat(MAX_LOCAL_RECORD_BYTES + 1024);

    // A: огромная запись, которая в облако не помещается никогда.
    activateDevice(A);
    await putMemory(A, uid, 'big', huge, 1000);
    await aiSyncRound(A, uid);
    const summaryA = getLocalStoreSyncSummary(uid);
    expect(summaryA.oversized, 'запись помечена «слишком большая»').toBeGreaterThanOrEqual(1);
    expect(managerRows().map(r => r.key), 'в облаке её нет').not.toContain('big');

    // B за это время выкладывает СВОЮ версию того же ключа — старее по содержимому,
    // новее по метке: ровно тот случай, где забор обязан пощадить локальную копию.
    activateDevice(B);
    await putMemory(B, uid, 'big', 'облачная-версия', 900);
    await aiSyncRound(B, uid);
    expect(cloudText('big'), 'облако приняло версию B').toBe('облачная-версия');

    activateDevice(A);
    await aiSyncRound(A, uid);
    const after = await localMemories(uid);
    expect(after.get('big'), 'гигантская локальная запись не затёрта облачной').toBe(huge);
    expect(getDeadStoreUpserts(uid), 'и не превратилась в мёртвую').toEqual([]);
  });

  it('запись, ужавшаяся до одной строки, выгружается и приезжает (SF-4)', async () => {
    const A = new Device('A'), B = new Device('B');
    const uid = await boot([A, B]);
    const long = 'y'.repeat(PAGE_SPLIT_THRESHOLD_BYTES + 4096);

    activateDevice(A);
    await putMemory(A, uid, 'paged', long, 1000);
    await aiSyncRound(A, uid);
    const pages = managerRows().map(r => String(r.key)).filter(k => k.startsWith('paged#'));
    expect(pages.length, 'длинная запись легла страницами').toBeGreaterThan(1);
    expect(managerRows().map(r => r.key), 'базовой строки у неё нет').not.toContain('paged');

    // Та же запись сжалась ниже потолка страниц: процесс «страницы → одна строка».
    await putMemory(A, uid, 'paged', 'стало коротко', 2000);
    await aiSyncRound(A, uid);
    const keys = managerRows().map(r => String(r.key));
    expect(keys, 'одна строка записана').toContain('paged');
    expect(cloudText('paged'), 'облако держит новый текст').toBe('стало коротко');
    expect(keys.filter(k => k.startsWith('paged#')), 'старые страницы снесены').toEqual([]);

    activateDevice(B);
    await aiSyncRound(B, uid);
    expect((await localMemories(uid)).get('paged'), 'второе устройство прочитало одну строку').toBe('стало коротко');
  });

  it('удалённая запись не возвращается ни на одном устройстве (I3)', async () => {
    const A = new Device('A'), B = new Device('B');
    const uid = await boot([A, B]);

    activateDevice(A);
    await putMemory(A, uid, 'm3', 'жила', 1000);
    await converge([A, B], uid);
    expect(cloudText('m3')).toBe('жила');
    expect((await localMemories(uid)).get('m3'), 'B получила запись').toBe('жила');

    activateDevice(A);
    await deleteMemory(A, uid, 'm3');
    await aiSyncRound(A, uid);
    expect(managerRows().map(r => String(r.key)), 'облачный ряд снесён').not.toContain('m3');

    await converge([A, B], uid, 4);
    activateDevice(A);
    expect((await localMemories(uid)).has('m3'), 'удаляющее устройство не воскресает ряд').toBe(false);
    expect(managerRows().map(r => String(r.key)), 'и в облаке он не появляется снова').not.toContain('m3');
  });

  it('чужих строк в облаке нет (I5)', async () => {
    const A = new Device('A'), B = new Device('B');
    const uid = await boot([A, B]);
    activateDevice(A);
    await putMemory(A, uid, 'm4', 'своё', 1000);
    activateDevice(B);
    await putMemory(B, uid, 'm5', 'тоже своё', 1100);
    await converge([A, B], uid);

    const owners = new Set(managerRows().map(r => String(r.user_id)));
    expect([...owners], 'каждый ряд принадлежит этому аккаунту').toEqual([uid]);
  });

  // SF2-2. Призрак из I6: облако приняло НАШУ запись, ответа мы не видели.
  // Прежний код на перечитке сверял облако с ТЕКУЩЕЙ локальной копией, не находил
  // равенства и объявлял чужую правку: пять попыток — и запись мёртва, дальше
  // любое её изменение ловит тот же отказ. Хэш последней отправленной нагрузки
  // отличает «там наше же» от «там чужое».
  it('обрыв ответа после принятой записи: правка после него догружается, запись не встаёт (SF2-2)', async () => {
    const A = new Device('A'), B = new Device('B');
    const uid = await boot([A, B]);

    activateDevice(A);
    await putMemory(A, uid, 'm2', 'до обрыва', 1000);
    await aiSyncRound(A, uid);
    expect(cloudText('m2')).toBe('до обрыва');

    // Фантомная запись: облако приняло новый текст, ответа человек не увидел.
    await putMemory(A, uid, 'm2', 'после обрыва', 2000);
    runner.interceptor.setStep('sync_cloud');
    runner.interceptor.armFault('network_post', 'sync_cloud', 'local_store_records');
    await managerOf(A).flushPending();
    runner.interceptor.clearArmedFault();
    runner.interceptor.setStep('initial_write');

    expect(cloudText('m2'), 'облако новую версию всё же приняло').toBe('после обрыва');
    const summary = getLocalStoreSyncSummary(uid);
    expect(summary.pending, 'без ответа обязательство НЕ снято: «нет ответа» ≠ «нет данных»').toBeGreaterThanOrEqual(1);
    expect(summary.dead, 'и запись не умерла').toBe(0);

    // Следующие проходы обязаны сойтись: и на A, и на B.
    await putMemory(A, uid, 'm2', 'после обрыва и ещё', 3000);
    await converge([A, B], uid);
    expect(getLocalStoreSyncSummary(uid).dead, 'мёртвых нет').toBe(0);
    expect(getDeadStoreUpserts(uid), 'в списке мёртвых её тоже нет').toEqual([]);
    expect(cloudText('m2'), 'облако догналось').toBe('после обрыва и ещё');
    activateDevice(B);
    expect((await localMemories(uid)).get('m2'), 'B привезло финальную версию').toBe('после обрыва и ещё');
  });

  // SF3-3 (ревью, раунд 3): прежний единственный слот `_cloudSentHash`
  // перезаписывался ПЕРЕД каждым запросом (`rememberSentHash`), а читался обратно
  // только при отказе CAS. Значит попытка, которая до сервера не дошла, стирает
  // доказательство предыдущей, дошедшей без ответа: `network_post` (фантом) →
  // `network_pre` (падение) → новая правка, и облачная НАША версия не узнаётся →
  // ложный конфликт → мёртвая запись → SF3-2. Мутация: вернуть одно поле вместо
  // списка → красное «облако догналось».
  it('фантом, потом падение до сервера: доказательство своей записи не потеряно (SF3-3)', async () => {
    const A = new Device('A'), B = new Device('B');
    const uid = await boot([A, B]);

    activateDevice(A);
    await putMemory(A, uid, 'm9', 'до обрыва', 1000);
    await aiSyncRound(A, uid);
    expect(cloudText('m9')).toBe('до обрыва');

    // 1. Дошло, ответа не было: в облаке лежит НАША версия.
    await putMemory(A, uid, 'm9', 'после обрыва', 2000);
    runner.interceptor.setStep('sync_cloud');
    runner.interceptor.armFault('network_post', 'sync_cloud', 'local_store_records');
    await managerOf(A).flushPending();
    runner.interceptor.clearArmedFault();
    runner.interceptor.setStep('initial_write');
    expect(cloudText('m9'), 'облако приняло нашу уехавшую версию').toBe('после обрыва');

    // 2. Правка, которая до сервера НЕ дошла. Слот хэша она всё равно заняла.
    await putMemory(A, uid, 'm9', 'правка после падения', 3000);
    runner.interceptor.setStep('sync_cloud');
    runner.interceptor.armFault('network_pre', 'sync_cloud', 'local_store_records');
    await managerOf(A).flushPending();
    runner.interceptor.clearArmedFault();
    runner.interceptor.setStep('initial_write');
    expect(cloudText('m9'), 'до сервера не дошло — облако прежнее').toBe('после обрыва');

    // 3. Дальше сеть есть: обязательство обязано закрыться по нашей же версии.
    await converge([A, B], uid, 4);
    expect(cloudText('m9'), 'облако догналось с нашей правкой').toBe('правка после падения');
    expect(getDeadStoreUpserts(uid), 'запись не ушла в мёртвые').toEqual([]);
    activateDevice(B);
    expect((await localMemories(uid)).get('m9'), 'и дошла до второго устройства').toBe('правка после падения');
  });

  // SF2-2. «Зашифровать всё» и «отправить всё» на другом устройстве пишут ряд
  // вслепую: меняется только серверная метка, содержимое остаётся прежним. Для
  // устройства, которое правит свою копию, это не чужая правка — и не должно
  // становиться вечным конфликтом.
  it('ряд перештампован без смены содержимого — правка второго устройства догружается (SF2-2)', async () => {
    const A = new Device('A'), B = new Device('B');
    const uid = await boot([A, B]);

    activateDevice(A);
    await putMemory(A, uid, 'm6', 'общая-версия', 1000);
    await converge([A, B], uid);
    activateDevice(B);
    expect((await localMemories(uid)).get('m6'), 'B привёз ряд').toBe('общая-версия');

    activateDevice(A);
    const row = await DataProvider.getLocalStoreRecord(uid, STORE, 'm6');
    expect(row, 'ряд в облаке лежит').not.toBeNull();
    await DataProvider.saveLocalStoreRecord(uid, STORE, 'm6', row!.payload as Record<string, unknown>);

    activateDevice(B);
    await putMemory(B, uid, 'm6', 'правка-B', 2000);
    await converge([A, B], uid, 4);
    expect(getDeadStoreUpserts(uid), 'запись не ушла в мёртвые').toEqual([]);
    expect(cloudText('m6'), 'облако приняло правку B').toBe('правка-B');
    activateDevice(A);
    expect((await localMemories(uid)).get('m6'), 'и дошла до A').toBe('правка-B');
  });

  // SF2-2, настоящий спор: чужое содержимое обычная выгрузка не перетирает —
  // его перетирает только явное «отправить всё» (путь «оставить моё»).
  it('настоящий конфликт: фоновая выгрузка отказывает, «отправить всё» оставляет моё (SF2-2)', async () => {
    const A = new Device('A'), B = new Device('B');
    const uid = await boot([A, B]);

    activateDevice(A);
    await putMemory(A, uid, 'm7', 'общая-версия', 1000);
    await converge([A, B], uid);

    activateDevice(B);
    await putMemory(B, uid, 'm7', 'версия-B', 2000);
    await aiSyncRound(B, uid);
    expect(cloudText('m7')).toBe('версия-B');

    // A правит ту же запись, не забирая чужое.
    activateDevice(A);
    await putMemory(A, uid, 'm7', 'версия-A', 3000);
    await aiSyncRound(A, uid);
    expect(cloudText('m7'), 'фоновая выгрузка чужое не затирает').toBe('версия-B');
    expect(getLocalStoreSyncSummary(uid).pending, 'и правка остаётся обязательством').toBeGreaterThanOrEqual(1);

    await managerOf(A).syncAllLocalStores(uid);
    expect(cloudText('m7'), 'явное «отправить всё» — путь «оставить моё»').toBe('версия-A');
    expect(getDeadStoreUpserts(uid), 'и записи больше не висят мёртвыми').toEqual([]);
  });

  // Приёмка раунда 3 (M-1): при нечитаемом журнале правок «отправить всё» считало
  // «своими» ВСЕ записи, включая те, что это устройство не трогало: после починки
  // журнала они вставали обязательствами, чужая новая версия не принималась, запись
  // умирала, а второе нажатие перетирало чужую правку устаревшей копией. На 0.10.3
  // запись с ушедшей вперёд облачной меткой пропускалась. Мутация: вернуть
  // `obligated === null || obligated.has(id)` — красный.
  it('нечитаемый журнал и «отправить всё»: чужая новая версия не перетирается (M-1)', async () => {
    const A = new Device('A'), B = new Device('B');
    const uid = await boot([A, B]);

    activateDevice(A);
    await putMemory(A, uid, 'm10', 'общая', 1000);
    await converge([A, B], uid);

    activateDevice(B);
    await putMemory(B, uid, 'm10', 'версия-B', 2000);
    await aiSyncRound(B, uid);
    expect(cloudText('m10')).toBe('версия-B');

    activateDevice(A);
    // Активное устройство живёт в настоящем localStorage (harnessDevice).
    localStorage.setItem(journalKeyFor('ai_sync_pending_upserts', uid), '{broken');
    await managerOf(A).syncAllLocalStores(uid);
    for (let round = 0; round < 7; round++) await aiSyncRound(A, uid);
    expect(getDeadStoreUpserts(uid).some(d => d.key === 'm10'), 'нетронутая запись не стала мёртвой').toBe(false);
    await managerOf(A).syncAllLocalStores(uid);
    expect(cloudText('m10'), 'второе «отправить всё» не перетирает чужую правку').toBe('версия-B');
    expect((await localMemories(uid)).get('m10'), 'A приняло версию B').toBe('версия-B');
  });

  // SF3-2 (ревью, раунд 3): «отправить всё» пропускал запись, если метка облака
  // ушла вперёд от запомненной базы (`syncAllLocalStores`) — а у мёртвой записи она ушла
  // ВСЕГДА (забор держит локальную копию и не берёт метку). Мёртвые не в очереди,
  // `forceOwn` до них не доходит, и предыдущий тест «настоящий конфликт» проходит
  // только потому, что гоняет ОДИН круг: запись ещё числится ожидающей.
  // Мутация: вернуть прежнее `continue` без проверки обязательства → красный
  // («облако осталось на версии B», мёртвые не очищены).
  it('шесть неудавшихся кругов и «отправить всё»: мёртвая запись выходит из тупика (SF3-2)', async () => {
    const A = new Device('A'), B = new Device('B');
    const uid = await boot([A, B]);

    activateDevice(A);
    await putMemory(A, uid, 'm8', 'общая-версия', 1000);
    await converge([A, B], uid);

    activateDevice(B);
    await putMemory(B, uid, 'm8', 'версия-B', 2000);
    await aiSyncRound(B, uid);
    expect(cloudText('m8')).toBe('версия-B');

    activateDevice(A);
    await putMemory(A, uid, 'm8', 'версия-A', 3000);
    for (let round = 0; round < 6; round++) await aiSyncRound(A, uid);
    expect(cloudText('m8'), 'фоновая выгрузка чужое не затирает').toBe('версия-B');
    expect(getDeadStoreUpserts(uid).some(d => d.key === 'm8'), 'и за запись берёт отметка «отвергнуто»').toBe(true);

    await managerOf(A).syncAllLocalStores(uid);
    expect(cloudText('m8'), '«отправить всё» обязан дойти и до мёртвой записи').toBe('версия-A');
    expect(getDeadStoreUpserts(uid), 'после этого мёртвых нет').toEqual([]);
    expect(getLocalStoreSyncSummary(uid).dead, 'и в счётчике бейджа тоже').toBe(0);

    await converge([A, B], uid, 2);
    activateDevice(B);
    expect((await localMemories(uid)).get('m8'), 'и правка дошла до второго устройства').toBe('версия-A');
  });

  // Случайная перестановка операций двух устройств: правки одного и того же
  // ключа, обрывы ответа, офлайн, «отправить всё». Проверяется после того, как
  // оба вернулись в сеть и синхронизировались несколько раундов:
  //  I1 — ни одна принятая локально правка не исчезла (на устройстве или в облаке);
  //  I2 — сходимость: если ряд на устройстве не ждёт отправки, он равен облаку;
  //  I3 — удалённое не воскресает;
  //  I4 — серверная метка ряда только растёт;
  //  I5 — все ряды принадлежат тестовому аккаунту;
  //  I6 — «нет ответа» ≠ «нет данных»: здесь его держат I1 (принятая локально
  //      правка живёт либо на устройстве, либо в облаке) и ослабление I2 (ряд
  //      обязан совпадать с облаком только если он ничего не должен). Отдельный
  //      сценарий с фантомной записью едет в SF2-2: на текущем коде он красный.
  const SEEDS = Number(process.env.AI_STORE_SEEDS ?? 12);
  const STEPS = Number(process.env.AI_STORE_STEPS ?? 14);
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`случайная перестановка, seed ${seed}`, async () => {
      let x = seed * 2654435761 % 2 ** 32;
      const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 2 ** 32; };
      const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;

      const A = new Device('A'), B = new Device('B');
      const uid = await boot([A, B]);
      const offline = new Map<Device, boolean>([[A, false], [B, false]]);
      const setNet = (dev: Device) => {
        const off = offline.get(dev)!;
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => !off });
        if (off) {
          runner.interceptor.setStep('device_b_edit');
          runner.interceptor.armFault('network_pre', 'device_b_edit', 'local_store_records');
        } else {
          runner.interceptor.clearArmedFault();
          runner.interceptor.setStep('initial_write');
        }
      };
      const keys = ['k1', 'k2', 'k3'];
      // Последняя принятая правка каждого ключа: скалярная запись перезаписывается
      // по одному месту, поэтому «не потеряно» проверяется по ней, а не по всем
      // текстам подряд (прежняя версия того же ключа обязана уйти).
      const lastAccepted = new Map<string, string>();
      const deleted = new Map<string, Device>();
      // «Чистое» удаление: в момент его ни одно другое устройство эту запись не
      // держит. Только тогда облако обязано остаться пустым. Если держит — другой
      // вкладке не о чём знать: у ИИ-сторов надгробий нет (план §2.3, этапы 3 и 6),
      // и её обычная выгрузка возвращает ряд в облако. Это известный пробел, он
      // записан в отчёт, а не скрыт ослабленным инвариантом.
      const cleanDeletes = new Set<string>();
      const log: string[] = [];
      let n = 0;

      for (let step = 0; step < STEPS; step++) {
        const dev = pick([A, B]);
        activateDevice(dev);
        setNet(dev);
        const text = `${dev.name}${seed}-${++n}`;
        const key = pick(keys);
        const r = rnd();
        const kind = r < 0.45 ? 'write' : r < 0.6 ? 'delete' : r < 0.85 ? 'sync' : 'all';
        try {
          if (r < 0.45) {
            await putMemory(dev, uid, key, text, 1000 + n);
            lastAccepted.set(key, text);
            deleted.delete(key);
            cleanDeletes.delete(key);
            log.push(`${dev.name}${offline.get(dev) ? '(off)' : ''} write ${key}=${text}`);
          } else if (r < 0.6) {
            await deleteMemory(dev, uid, key);
            deleted.set(key, dev);
            const other = dev === A ? B : A;
            if ((await peekLocal(other, uid)).has(key)) {
              log.push(`  (delete ${key}: ${other.name} держит копию — её выгрузка вернёт ряд в облако)`);
            } else {
              cleanDeletes.add(key);
            }
            log.push(`${dev.name} delete ${key}`);
          } else if (r < 0.85) {
            await aiSyncRound(dev, uid);
            log.push(`${dev.name}${offline.get(dev) ? '(off)' : ''} sync`);
          } else {
            await managerOf(dev).syncAllLocalStores(uid);
            await restoreAIDataFromCloud(uid, { sinceMs: 0 });
            log.push(`${dev.name}${offline.get(dev) ? '(off)' : ''} send-all`);
          }
        } catch (e) {
          if (!offline.get(dev)) throw new Error(`online op failed: ${(e as Error).message}\n${log.join('\n')}`);
          const local = await localMemories(uid);
          if (local.get(key) === text) lastAccepted.set(key, text);
          log.push(`${dev.name}(off) ${kind} ${key} threw: ${(e as Error).message}`);
        }
      }

      offline.set(A, false);
      offline.set(B, false);
      await converge([A, B], uid, 4);

      activateDevice(A);
      const a = await snapshot(uid);
      activateDevice(B);
      const b = await snapshot(uid);
      const cloud = new Set(managerRows().map(r => cloudText(String(r.key))));
      const dump = `A: ${JSON.stringify([...a.local])}\nB: ${JSON.stringify([...b.local])}\ncloud: ${JSON.stringify(managerRows().map(r => `${r.key}:${String(cloudText(String(r.key))).slice(0, 12)}`))}\n${log.join('\n')}`;

      // I1 по ЗНАЧЕНИЯМ: карта снимка — это id → текст, а «текст жив» смотрим по
      // значениям, иначе проверка на `has(text)` искала бы текст среди ключей.
      const texts = new Set([...a.local.values(), ...b.local.values(), ...cloud]);
      const lost = [...lastAccepted]
        .filter(([key, text]) => !deleted.has(key) && !texts.has(text))
        .map(([key, text]) => `${key}=${text}`);
      expect(lost, `I1: принятые правки потеряны\n${dump}`).toEqual([]);

      for (const [name, dev] of [['A', a], ['B', b]] as const) {
        for (const [key, text] of dev.local) {
          if (cloud.has(text)) continue;
          // Право на «отличаться от облака» есть только у того, что ещё должно
          // уехать: ждёт отправки (союз журналов SF-1 включает мёртвые и
          // большие), умерло, или журнал не читается — «не знаю».
          if (dev.pendingKeys === null || dev.pendingKeys.has(`${STORE}:${key}`) || dev.dead.has(key)) continue;
          // I2: ряд, который не ждёт отправки, обязан совпадать с облаком.
          if (cloudText(key) !== undefined) {
            expect(text, `I2: ${name}/${key} расходится с облаком и не в очереди\n${dump}`).toBe(cloudText(key));
          }
        }
      }

      for (const key of cleanDeletes) {
        const cloudHas = managerRows().some(r => String(r.key) === key);
        expect(cloudHas, `I3: удалённый ${key} воскрес в облаке\n${dump}`).toBe(false);
      }

      for (const [key, hist] of stampHistory) {
        for (let i = 1; i < hist.length; i++) {
          expect(hist[i]! > hist[i - 1]!, `I4: метка ряда ${key} не монотонна: ${hist.join(' → ')}\n${dump}`).toBe(true);
        }
      }

      const owners = new Set(managerRows().map(r => String(r.user_id)));
      expect([...owners], `I5: чужие ряды\n${dump}`).toEqual([uid]);
    }, 120_000);
  }
});
