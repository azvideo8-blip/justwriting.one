import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import {
  LocalStoreSyncService,
  getDeadStoreUpserts,
  getOversizedRecords,
  getPendingUpsertKeySet,
  CLOUD_STAMP_FIELD,
  MAX_LOCAL_RECORD_BYTES,
  PAGE_SPLIT_THRESHOLD_BYTES,
  PAGES_PER_REQUEST,
} from '../LocalStoreSyncService';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';

// SF-1 и SF-3 (ревью `sync-step0`): запись, у которой ОТКАЗнула выгрузка, перестаёт
// быть «ожидающей» ровно в тот момент, когда это опаснее всего.
//
// SF-1. После MAX_UPSERT_ATTEMPTS отказа запись уходит в `ai_sync_dead_upserts`, а
// отметка в журнале невыгруженных правок СНИМАЕТСЯ. На следующем заборе
// `decideScalarCopy` не видит ожидающей правки, видит известную базу и более новый
// штамп облака → `cloud`: своя правка затёрта, остался только значок «мёртвая».
// Второе устройство не нужно: v1 записана в облако, но ответ потерян (новый штамп
// не сохранён) → правка v2 не проходит условную запись пять раз → забор возвращает v1.
//
// SF-3. То же для записей, которые не могут быть «ожидающими» по устройству: слишком
// большие снимают отметку в `markOversized`. У такой записи почти никогда нет базы,
// и правило S0-3 («нет базы, содержимое отличается, правки в очереди нет → облако»)
// заменяет самую новую копию, которая есть только на этом устройстве, старой облачной.
// На `main` правило по времени оставляло локальную — то есть S0-3 принёс потерю там,
// где её не было.
//
// Правка: `getPendingUpsertKeySet` = журнал ∪ мёртвые ∪ слишком большие, и любой из
// трёх журналов, который не читается, — `null` («не знаю»), а не «правок нет».
//
// Харнесс боевой: настоящий провайдер `localStore` (условная запись, чтение облака),
// настоящий дренаж `LocalStoreSyncService`, настоящий забор `restoreAIDataFromCloud`.
// Подменён только клиент PostgREST — таблица честна к микросекундам `stamped_at`
// (см. `scalarUploadCas.s01`): усечённое равенство не должно проходить.

const UID = 'u_sf1_rejection';
const HOUR = 3_600_000;
const SERVER_BASE = Date.UTC(2026, 9, 17, 12, 0, 0);
/** Как MAX_UPSERT_ATTEMPTS: на этом проходе правка уходит в журнал отвергнутых. */
const DEATH_PASS = 6;

type Row = {
  user_id: string;
  store: string;
  key: string;
  payload: Record<string, unknown>;
  stamped_at: string;
};

/** Таблицы раздельно: забор читает `ai_summaries` и `local_store_records` одним
 *  билдером, и подмена не должна отдавать строки одного стола другому. */
let tables: Record<string, Row[]>;
/** Что реально ушло в облако — «что стало» без «что ушло» не отличает отказ от «код не дошёл». */
let ops: Array<{ op: string; table: string; key: string; where: string[] }>;
let stampTick = 0;

const cloudTable = () => tables.local_store_records ?? [];
const setCloudTable = (rows: Row[]) => { tables.local_store_records = rows; };

/** Отметка сервера с долей миллисекунды в микросекундах — не кратна 1000. */
const serverStamp = (ms: number) => {
  const usWithinMs = 100 + ++stampTick * 7;
  return `${new Date(ms).toISOString().replace('Z', '')}${String(usWithinMs).padStart(3, '0')}+00:00`;
};
/** Точный разбор: Date.parse отбрасывает µs-хвост, здесь он значим. */
const toMicro = (v: string): number => {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m) return Date.parse(v) * 1000;
  return Date.parse(`${m[1]}.000${m[3]}`) * 1000 + Number((m[2] ?? '').padEnd(6, '0').slice(0, 6));
};


class Q {
  private f: Array<[string, unknown]> = [];
  private g: Array<[string, string]> = [];
  private lt_: Array<[string, string]> = [];
  private nq: Array<[string, unknown]> = [];
  private l: Array<[string, string]> = [];
  private del = false;
  private ins: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private write: 'insert' | 'upsert' | null = null;
  private upd: Record<string, unknown> | null = null;
  private __range: [number, number] | null = null;
  private single = false;

  constructor(private readonly table: string) {}

  select() { return this; }
  insert(row: Record<string, unknown>) { this.ins = row; this.write = 'insert'; return this; }
  upsert(row: Record<string, unknown> | Record<string, unknown>[]) { this.ins = row; this.write = 'upsert'; return this; }
  update(patch: Record<string, unknown>) { this.upd = patch; return this; }
  delete() { this.del = true; return this; }
  eq(col: string, val: unknown) { this.f.push([col, val]); return this; }
  is(col: string, val: unknown) { this.f.push([col, val]); return this; }
  neq(col: string, val: unknown) { this.nq.push([col, val]); return this; }
  in(col: string, vals: unknown[]) { this.f.push([col, { __in: vals }]); return this; }
  gt(col: string, val: unknown) { this.g.push([col, String(val)]); return this; }
  gte(col: string, val: unknown) { this.g.push([`${col}>=`, String(val)]); return this; }
  lt(col: string, val: unknown) { this.lt_.push([col, String(val)]); return this; }
  like(col: string, glob: string) { this.l.push([col, glob]); return this; }
  order() { return this; }
  limit() { return this; }
  range(from: number, to: number) { this.__range = [from, to]; return this; }
  maybeSingle() { this.single = true; return this; }

  private get rows(): Row[] { return tables[this.table] ?? []; }
  private set rows(rows: Row[]) { tables[this.table] = rows; }

  private matches(r: Row): boolean {
    for (const [col, val] of this.f) {
      if (col === 'stamped_at') {
        if (toMicro(r.stamped_at) !== toMicro(String(val))) return false;
        continue;
      }
      if (col === 'payload->>updatedAt') {
        if (String(r.payload.updatedAt ?? '') !== String(val)) return false;
        continue;
      }
      const rec = r as unknown as Record<string, unknown>;
      if (val && typeof val === 'object' && '__in' in (val as Record<string, unknown>)) {
        if (!(val as { __in: unknown[] }).__in.includes(rec[col])) return false;
        continue;
      }
      if (rec[col] !== val) return false;
    }
    for (const [col, val] of this.nq) {
      if ((r as unknown as Record<string, unknown>)[col] === val) return false;
    }
    for (const [col, val] of this.g) {
      const lower = col.endsWith('>=');
      const name = lower ? col.slice(0, -2) : col;
      if (name === 'stamped_at') {
        const mine = toMicro(r.stamped_at);
        const other = toMicro(val);
        if (lower ? !(mine >= other) : !(mine > other)) return false;
        continue;
      }
      if (name === 'payload->>updatedAt') {
        if (!(String(r.payload.updatedAt ?? '') > val)) return false;
        continue;
      }
      throw new Error(`неизвестный фильтр ${col}`);
    }
    for (const [col, val] of this.lt_) {
      if (col === 'stamped_at') { if (!(toMicro(r.stamped_at) < toMicro(val))) return false; continue; }
      throw new Error(`неизвестный фильтр ${col}`);
    }
    for (const [col, glob] of this.l) {
      const prefix = glob.replace(/%/g, '').replace(/\\([\\%_])/g, '$1');
      if (!String((r as unknown as Record<string, unknown>)[col]).startsWith(prefix)) return false;
    }
    return true;
  }

  private find(): Row[] { return this.rows.filter(r => this.matches(r)); }

  /** Настоящий билдер PostgREST — thenable: запрос исполняется, когда его ждут. */
  then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
    return this.run().then(onFulfilled, onRejected);
  }

  private whereCols(): string[] {
    return this.f.map(([c]) => c)
      .concat(this.g.map(([c]) => c))
      .concat(this.lt_.map(([c]) => c))
      .concat(this.nq.map(([c]) => c))
      .concat(this.l.map(([c]) => c));
  }

  private run(): Promise<{ data: unknown; error: unknown }> {
    const id = (row: Record<string, unknown>) => `${String(row.store)}|${String(row.key)}`;
    const nextStamp = () => serverStamp(SERVER_BASE + 60_000 * (ops.length + 1));

    if (this.upd) {
      const hits = this.find();
      ops.push({ op: 'update', table: this.table, key: hits[0] ? id(hits[0]) : '—', where: this.whereCols() });
      for (const r of hits) {
        Object.assign(r, this.upd);
        r.stamped_at = nextStamp();
      }
      return Promise.resolve({ data: this.single ? (hits[0] ?? null) : hits, error: null });
    }

    if (this.ins) {
      const rows = Array.isArray(this.ins) ? this.ins : [this.ins];
      if (Array.isArray(this.ins)) {
        ops.push({ op: 'upsert-batch', table: this.table, key: rows.map(id).join(','), where: [] });
        const kept = this.rows.filter(r => !rows.some(row => r.store === row.store && r.key === row.key));
        for (const row of rows) {
          kept.push({
            user_id: String(row.user_id), store: String(row.store), key: String(row.key),
            payload: row.payload as Record<string, unknown>, stamped_at: nextStamp(),
          });
        }
        this.rows = kept;
        return Promise.resolve({ data: null, error: null });
      }
      const one = this.ins as Record<string, unknown>;
      if (this.write === 'upsert') {
        ops.push({ op: 'upsert', table: this.table, key: id(one), where: [] });
        const kept = this.rows.filter(r => !(r.store === one.store && r.key === one.key));
        const replaced: Row = {
          user_id: String(one.user_id), store: String(one.store), key: String(one.key),
          payload: (one.payload ?? {}) as Record<string, unknown>, stamped_at: nextStamp(),
        };
        kept.push(replaced);
        this.rows = kept;
        return Promise.resolve({ data: this.single ? replaced : [replaced], error: null });
      }
      if (this.rows.find(r => r.store === one.store && r.key === one.key)) {
        ops.push({ op: 'insert-rejected', table: this.table, key: id(one), where: this.whereCols() });
        return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique key' } });
      }
      ops.push({ op: 'insert', table: this.table, key: id(one), where: this.whereCols() });
      const inserted: Row = {
        user_id: String(one.user_id), store: String(one.store), key: String(one.key),
        payload: (one.payload ?? {}) as Record<string, unknown>, stamped_at: nextStamp(),
      };
      this.rows = [...this.rows, inserted];
      return Promise.resolve({ data: this.single ? inserted : [inserted], error: null });
    }

    let hits = this.find();
    if (this.del) {
      const doomed = new Set(hits.map(r => `${r.store}|${r.key}`));
      ops.push({ op: 'delete', table: this.table, key: [...doomed].join(','), where: this.whereCols() });
      this.rows = this.rows.filter(r => !doomed.has(`${r.store}|${r.key}`));
      return Promise.resolve({ data: null, error: null });
    }
    if (this.__range) hits = hits.slice(this.__range[0], this.__range[1] + 1);
    if (this.single) return Promise.resolve({ data: hits[0] ?? null, error: null });
    return Promise.resolve({ data: hits, error: null });
  }
}

vi.mock('../../supabase/client', () => ({
  getSupabase: () => ({
    from: (table: string) => new Q(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: UID, email: 'u@example.com' }),
  getCurrentUserId: () => UID,
}));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
}));
vi.mock('../../crypto/encrypt', () => ({ getSessionKey: () => ({}) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

/** Ровно те байты, которые продукт кладёт в `payload.data` при выгрузке. */
const portraitJson = (summary: string) => JSON.stringify({ id: 'singleton', summary, updatedAt: SERVER_BASE - HOUR });

/** Облачная версия `summary`, принятая сервером в `stampMs`. */
function seedCloud(summary: string, stampMs = SERVER_BASE) {
  setCloudTable([{
    user_id: UID, store: 'aiPortrait', key: 'singleton',
    payload: { data: portraitJson(summary), updatedAt: stampMs },
    stamped_at: serverStamp(stampMs),
  }]);
}

const cloudRow = () => cloudTable().find(r => r.store === 'aiPortrait' && r.key === 'singleton');
const cloudSummary = () => JSON.parse(String(cloudRow()?.payload.data ?? '{}')).summary as string | undefined;
/** µs с начала эпохи; отсутствие ряда — ошибка настройки теста, а не «облако пусто». */
const cloudStamp = (): number => {
  const r = cloudRow();
  if (!r) throw new Error('облачного ряда aiPortrait|singleton нет — тест настроен неверно');
  return toMicro(r.stamped_at);
};

async function localPortrait(summary: string, stampBase?: number) {
  const db = await getLocalDb(UID);
  await db.put('aiPortrait', {
    id: 'singleton', summary, updatedAt: SERVER_BASE - HOUR,
    ...(stampBase === undefined ? {} : { [CLOUD_STAMP_FIELD]: stampBase }),
  } as never);
  return db;
}

async function readLocal(db: Awaited<ReturnType<typeof getLocalDb>>): Promise<Record<string, unknown>> {
  return await db.get('aiPortrait', 'singleton') as unknown as Record<string, unknown>;
}

const pendingJournalHas = (key: string) => {
  const raw = localStorage.getItem('ai_sync_pending_upserts:' + UID);
  return raw !== null && raw.includes(key);
};

describe('SF-1/SF-3: отказ выгрузки не превращает локальную правку в «ожидает»-отсутствующую', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ops = [];
    tables = {};
    stampTick = 0;
    localStorage.clear();
    resetDbInstance();
    // SF-5: обёртка `put` читает прежнюю строку, а fake-indexeddb переживает
    // resetDbInstance — без очистки «копия без базы» доставала бы отметку из
    // предыдущего прогона.
    await (await getLocalDb(UID)).clear('aiPortrait');
  });

  afterEach(() => { resetDbInstance(); });

  // Мутация: `getPendingUpsertKeySet` снова только журнал правок → забор стирает 'с-B'.
  it('SF-1: пять отказов и забор — своя правка v2 цела, облако остаётся на v1', async () => {
    seedCloud('общее-исходное', SERVER_BASE);
    await localPortrait('с-A', SERVER_BASE);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    expect((await LocalStoreSyncService.flushPending(true)).synced).toBe(1);
    expect(cloudSummary()).toBe('с-A');
    const stampAfterA = cloudStamp();

    // Правка v2, сделанная поверх утерянного ответа: базу она не знает свежую, и
    // условная запись пять раз отказывает — «правили на другом устройстве».
    await localPortrait('с-B', SERVER_BASE);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    for (let i = 0; i < DEATH_PASS; i++) await LocalStoreSyncService.flushPending(true);

    expect(getDeadStoreUpserts(UID).some(d => d.store === 'aiPortrait' && d.key === 'singleton'),
      'отвергнутая правка видна в журнале отвергнутых').toBe(true);
    expect(pendingJournalHas('"aiPortrait"'),
      'в журнале невыгруженных её больше нет — именно поэтому нужен союз с мёртвыми').toBe(false);
    expect(getPendingUpsertKeySet(UID)?.has('aiPortrait:singleton'),
      'но запись по-прежнему считается имеющей невыгруженную правку').toBe(true);

    await restoreAIDataFromCloud(UID, {});

    const local = await readLocal(await getLocalDb(UID));
    expect(local.summary, 'забор не имеет права затирать правку, которая не смогла уехать').toBe('с-B');
    expect(cloudSummary(), 'облако осталось на правке A').toBe('с-A');
    expect(cloudStamp(), 'и ряд не переписан').toBe(stampAfterA);
  });

  // Мутация: не снимать отметку «мёртвая» при уехавшем удалении → заложник навсегда.
  it('контроль: запись удалили — отметка снята, и облачная копия приезжает', async () => {
    seedCloud('общее-исходное', SERVER_BASE);
    await localPortrait('с-A', SERVER_BASE);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    await LocalStoreSyncService.flushPending(true);

    const db = await localPortrait('с-B', SERVER_BASE);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    for (let i = 0; i < DEATH_PASS; i++) await LocalStoreSyncService.flushPending(true);
    expect(getPendingUpsertKeySet(UID)?.has('aiPortrait:singleton')).toBe(true);

    // Как делает писатель: локальную копию он сносит сам, в очередь остаётся
    // уйти удаление и снять все три отметки.
    await db.delete('aiPortrait', 'singleton');
    LocalStoreSyncService.scheduleStoreDelete('aiPortrait', 'singleton');
    await LocalStoreSyncService.flushPending(true);
    expect(getPendingUpsertKeySet(UID)?.has('aiPortrait:singleton'),
      'локальной копии нет — удерживать её больше нечем').toBe(false);

    seedCloud('с-A', SERVER_BASE + HOUR);
    await restoreAIDataFromCloud(UID, {});
    const local = await readLocal(db);
    expect(local.summary, 'после удаления облачная копия восстанавливается, а не заложит').toBe('с-A');
  });

  // Мутация: `readOversizedRecords` не участвует в союзе → большая копия стёрта облачной.
  it('SF-3: запись больше потолка без базы — единственная копия не уступает облаку', async () => {
    // Больше PAGES_PER_REQUEST страниц → `markOversized`, в облако такая не поедет никогда.
    const big = 'x'.repeat(PAGE_SPLIT_THRESHOLD_BYTES * PAGES_PER_REQUEST);
    const db = await localPortrait(big);

    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);
    expect(res.skippedOversized, 'запись помечена «слишком большая»').toBe(1);
    expect(getOversizedRecords(UID).some(r => r.store === 'aiPortrait' && r.key === 'singleton')).toBe(true);
    expect(pendingJournalHas('"aiPortrait"'),
      'отметка в журнале правок снята — её заменяет отметка «слишком большая»').toBe(false);
    expect(getPendingUpsertKeySet(UID)?.has('aiPortrait:singleton'),
      'но для спора копий она обязана считаться невыгруженной').toBe(true);

    // Облако держит прежнюю короткую версию.
    seedCloud('облако-из-прошлого', SERVER_BASE);
    await restoreAIDataFromCloud(UID, {});

    const local = await readLocal(db);
    expect(String(local.summary).length, 'самая новая копия, которая есть только на этом устройстве, цела').toBe(big.length);
    expect(local.summary).toBe(big);
  });

  it('журнал отвергнутых не читается — «не знаю» не равно «нет правок»', async () => {
    seedCloud('общее-исходное', SERVER_BASE);
    await localPortrait('с-A', SERVER_BASE);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    await LocalStoreSyncService.flushPending(true);
    await localPortrait('с-B', SERVER_BASE);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    for (let i = 0; i < DEATH_PASS; i++) await LocalStoreSyncService.flushPending(true);

    localStorage.setItem('ai_sync_dead_upserts:' + UID, '{битый');
    expect(getPendingUpsertKeySet(UID), 'нечитаемый журнал отвергнутых — null').toBeNull();

    await restoreAIDataFromCloud(UID, {});
    expect((await readLocal(await getLocalDb(UID))).summary).toBe('с-B');
  });

  it('журнал слишком больших не читается — локальная копия тоже остаётся', async () => {
    const db = await localPortrait('y'.repeat(MAX_LOCAL_RECORD_BYTES + 1024));
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    expect((await LocalStoreSyncService.flushPending(true)).skippedOversized).toBe(1);

    localStorage.setItem('ai_sync_oversized_records:' + UID, '{битый');
    expect(getPendingUpsertKeySet(UID)).toBeNull();

    seedCloud('облако-из-прошлого', SERVER_BASE);
    await restoreAIDataFromCloud(UID, {});
    expect(String((await readLocal(db)).summary).length).toBeGreaterThan(MAX_LOCAL_RECORD_BYTES);
  });

  it('обычная очередь правок работает как раньше (союз ничего не теряет)', () => {
    localStorage.setItem('ai_sync_pending_upserts:' + UID, JSON.stringify([
      { uid: UID, store: 'aiPersonas', key: 'p1' },
      { uid: 'u_чужой', store: 'aiPortrait', key: 'singleton' },
    ]));
    const set = getPendingUpsertKeySet(UID);
    expect(set?.has('aiPersonas:p1')).toBe(true);
    expect(set?.has('aiPortrait:singleton'), 'чужая строка не добавляет мне удержания').toBe(false);
  });
});
