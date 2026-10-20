import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import {
  LocalStoreSyncService,
  getDeadStoreUpserts,
  CLOUD_STAMP_FIELD,
  PAGE_SPLIT_THRESHOLD_BYTES,
} from '../LocalStoreSyncService';

// SF-4 (ревью `sync-step0`): постраничная запись, у которой новый текст уложился в
// одну строку, больше не выгружается НИКОГДА.
//
// База, которую помнит локальная копия, — максимум серверных отметок СТРАНИЦ
// `key#N` (так её ставит забор: строки `key` у группы нет). Условная запись
// `uploadScalar` целится в строку `key` — её в облаке нет, UPDATE не задевает ни
// одной строки, «конфликт». Перечитка по точному ключу возвращает null → отказ
// «cloud row disappeared mid-upload», пять попыток → мёртвая запись. Облако
// держит прежние страницы, все следующие правки падают так же, другие устройства
// изменений не видят.
//
// Правка: если базовой строки в облаке нет, но группа страниц есть и её отметка не
// ушла вперёд от нашей базы — это переход «страницы → одна строка»: вставка с
// проверкой отсутствия (23505 = конфликт, а не затирание), а страницы сносит уже
// стоящий в дренаже `deleteLocalStorePagedRecords` после успешной записи. Если же
// страницы новее нашей базы — отказ: мы не знаем, чья версия переведёт.
//
// Харнесс боевой: настоящий провайдер `localStore`, настоящий дренаж. Подменён
// только клиент PostgREST.

const UID = 'u_sf4_shrank';
const HOUR = 3_600_000;
const SERVER_BASE = Date.UTC(2026, 9, 17, 12, 0, 0);
const DEATH_PASS = 6;

type Row = {
  user_id: string;
  store: string;
  key: string;
  payload: Record<string, unknown>;
  stamped_at: string;
};

let table: Row[];
let ops: Array<{ op: string; key: string; where: string[] }>;
let stampTick = 0;

const iso = (ms: number) => {
  const us = 100 + ++stampTick * 7;
  return `${new Date(ms).toISOString().replace('Z', '')}${String(us).padStart(3, '0')}+00:00`;
};
const toMicro = (v: string): number => Date.parse(v.replace(/\+\d{2}:\d{2}$/, '+00:00').replace(/(\.\d{3})\d+/, '$1'));

class Q {
  private f: Array<[string, unknown]> = [];
  private lt_: Array<[string, string]> = [];
  private l: Array<[string, string]> = [];
  private del = false;
  private ins: Record<string, unknown> | null = null;
  private upd: Record<string, unknown> | null = null;
  private __range: [number, number] | null = null;
  private single = false;

  select() { return this; }
  insert(row: Record<string, unknown>) { this.ins = row; return this; }
  upsert(row: Record<string, unknown>) { this.ins = row; return this; }
  update(patch: Record<string, unknown>) { this.upd = patch; return this; }
  delete() { this.del = true; return this; }
  eq(col: string, val: unknown) { this.f.push([col, val]); return this; }
  is(col: string, val: unknown) { this.f.push([col, val]); return this; }
  in(col: string, vals: unknown[]) { this.f.push([col, { __in: vals }]); return this; }
  gt(col: string, val: unknown) { this.lt_.push([`>${col}`, String(val)]); return this; }
  gte(col: string, val: unknown) { this.lt_.push([`>=${col}`, String(val)]); return this; }
  lt(col: string, val: unknown) { this.lt_.push([col, String(val)]); return this; }
  like(col: string, glob: string) { this.l.push([col, glob]); return this; }
  order() { return this; }
  limit() { return this; }
  range(from: number, to: number) { this.__range = [from, to]; return this; }
  maybeSingle() { this.single = true; return this; }

  then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
    return this.run().then(onFulfilled, onRejected);
  }

  private match(r: Row): boolean {
    for (const [col, val] of this.f) {
      const rec = r as unknown as Record<string, unknown>;
      if (val && typeof val === 'object' && '__in' in (val as Record<string, unknown>)) {
        if (!(val as { __in: unknown[] }).__in.includes(rec[col])) return false;
        continue;
      }
      if (rec[col] !== val) return false;
    }
    for (const [col, val] of this.lt_) {
      if (col.startsWith('>=')) {
        if (!(toMicro(r.stamped_at) >= toMicro(val))) return false;
        continue;
      }
      if (col.endsWith('>')) {
        if (!(toMicro(r.stamped_at) > toMicro(val))) return false;
        continue;
      }
      if (col === 'stamped_at') { if (!(toMicro(r.stamped_at) < toMicro(val))) return false; continue; }
      throw new Error(`неизвестный фильтр ${col}`);
    }
    for (const [col, glob] of this.l) {
      const prefix = glob.replace(/%$/, '').replace(/\\([\\%_])/g, '$1');
      if (!String((r as unknown as Record<string, unknown>)[col]).startsWith(prefix)) return false;
    }
    return true;
  }

  private whereCols(): string[] {
    return this.f.map(([c]) => c).concat(this.lt_.map(([c]) => c)).concat(this.l.map(([c]) => c));
  }

  private run(): Promise<{ data: unknown; error: unknown }> {
    const id = (one: Record<string, unknown>) => `${String(one.store)}|${String(one.key)}`;

    if (this.upd) {
      const hits = table.filter(r => this.match(r));
      ops.push({ op: 'update', key: hits[0] ? `${hits[0].store}|${hits[0].key}` : '—', where: this.whereCols() });
      for (const r of hits) {
        Object.assign(r, this.upd);
        r.stamped_at = iso(SERVER_BASE + HOUR + 60_000 * ops.length);
      }
      return Promise.resolve({ data: this.single ? (hits[0] ? { stamped_at: hits[0].stamped_at } : null) : hits, error: null });
    }

    if (this.ins) {
      const one = this.ins;
      if (table.find(r => r.store === one.store && r.key === one.key)) {
        ops.push({ op: 'insert-rejected', key: id(one), where: this.whereCols() });
        return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique key' } });
      }
      ops.push({ op: 'insert', key: id(one), where: this.whereCols() });
      const inserted: Row = {
        user_id: String(one.user_id), store: String(one.store), key: String(one.key),
        payload: (one.payload ?? {}) as Record<string, unknown>,
        stamped_at: iso(SERVER_BASE + HOUR + 60_000 * ops.length),
      };
      table.push(inserted);
      return Promise.resolve({ data: this.single ? { stamped_at: inserted.stamped_at } : [inserted], error: null });
    }

    let hits = table.filter(r => this.match(r));
    if (this.del) {
      const doomed = new Set(hits.map(r => `${r.store}|${r.key}`));
      ops.push({ op: 'delete', key: [...doomed].join(','), where: this.whereCols() });
      table = table.filter(r => !doomed.has(`${r.store}|${r.key}`));
      return Promise.resolve({ data: null, error: null });
    }
    if (this.__range) hits = hits.slice(this.__range[0], this.__range[1] + 1);
    if (this.single) return Promise.resolve({ data: hits[0] ?? null, error: null });
    return Promise.resolve({ data: hits, error: null });
  }
}

vi.mock('../../supabase/client', () => ({
  getSupabase: () => ({ from: () => new Q(), rpc: () => Promise.resolve({ data: null, error: null }) }),
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

const row = (key: string) => table.find(r => r.key === key);
const rowStamp = (key: string): number => {
  const r = row(key);
  if (!r) throw new Error(`строки ${key} в облаке нет — тест настроен неверно`);
  return Date.parse(r.stamped_at);
};

/** Облако держит СТРАНИЦЫ `singleton#0…N` прежней большой версии. Базовой строки нет. */
function seedPages(pageCount: number, stampMs: number) {
  const summary = 'б'.repeat(PAGE_SPLIT_THRESHOLD_BYTES);
  const full = JSON.stringify({ id: 'singleton', summary, updatedAt: stampMs - HOUR });
  table = [];
  for (let i = 0; i < pageCount; i++) {
    table.push({
      user_id: UID, store: 'aiPortrait', key: `singleton#${i}`,
      payload: { data: full.slice(i * 1000, (i + 1) * 1000), updatedAt: stampMs, page: i, totalPages: pageCount },
      stamped_at: iso(stampMs),
    });
  }
  return { full, summary };
}

async function localPortrait(summary: string, stampBase?: number) {
  const db = await getLocalDb(UID);
  await db.put('aiPortrait', {
    id: 'singleton', summary, updatedAt: SERVER_BASE,
    ...(stampBase === undefined ? {} : { [CLOUD_STAMP_FIELD]: stampBase }),
  } as never);
  return db;
}

async function readLocal(db: Awaited<ReturnType<typeof getLocalDb>>): Promise<Record<string, unknown>> {
  return await db.get('aiPortrait', 'singleton') as unknown as Record<string, unknown>;
}

describe('SF-4: постраничная запись, ужавшаяся до одной строки, выгружается', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ops = [];
    table = [];
    stampTick = 0;
    localStorage.clear();
    resetDbInstance();
    // SF-5: обёртка `put` читает прежнюю строку, а fake-indexeddb переживает
    // resetDbInstance — без очистки база копии приходила из предыдущего прогона.
    await (await getLocalDb(UID)).clear('aiPortrait');
  });

  afterEach(() => { resetDbInstance(); });

  // Мутация: вернуть прежний отказ `disappeared mid-upload` (не вызывать вставку)
  // → красный на этом же тесте.
  it('база — по страницам, строки key нет: правка уходит вставкой и страницы сносятся', async () => {
    seedPages(2, SERVER_BASE);
    const pagesMax = Math.max(rowStamp('singleton#0'), rowStamp('singleton#1'));
    const db = await localPortrait('укоротили до одной строки', pagesMax);

    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);

    expect(res.synced, 'переход «страницы → одна строка» обязан выгрузиться').toBe(1);
    expect(res.failed, 'и не уйти в отказы').toBe(0);
    expect(row('singleton'), 'одна строка в облаке появилась').toBeTruthy();
    expect(String(JSON.parse(String(row('singleton')?.payload.data ?? '{}')).summary))
      .toBe('укоротили до одной строки');
    expect(row('singleton#0'), 'прежние страницы снесены после принятой записи').toBeFalsy();
    expect(row('singleton#1')).toBeFalsy();
    expect(Number((await readLocal(db))[CLOUD_STAMP_FIELD]), 'новая серверная отметка принята')
      .toBeGreaterThanOrEqual(rowStamp('singleton'));
    expect(getDeadStoreUpserts(UID)).toHaveLength(0);
  });

  // Мутация: не сверять отметку группы с базой (вставлять вслепую) → красный.
  it('страницы ушли вперёд от нашей базы — отказ, чужая версия целая', async () => {
    seedPages(2, SERVER_BASE);
    const staleBase = rowStamp('singleton#0') - HOUR;
    await localPortrait('моя-на-старой-базе', staleBase);

    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    for (let i = 0; i < DEATH_PASS; i++) await LocalStoreSyncService.flushPending(true);

    expect(row('singleton'), 'ни вставки, ни затирания').toBeFalsy();
    expect(row('singleton#0'), 'чужие страницы целы').toBeTruthy();
    expect(getDeadStoreUpserts(UID).some(d => d.store === 'aiPortrait' && d.key === 'singleton'),
      'отказ виден в журнале отвергнутых').toBe(true);
  });

  it('группы страниц нет вовсе — прежний отказ, а не вставка вслепую', async () => {
    table = [];
    await localPortrait('моя', SERVER_BASE);

    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);

    expect(res.synced).toBe(0);
    expect(res.failed).toBe(1);
    expect(ops.map(o => o.op), 'ни записей, ни удалений не было').toEqual(['update']);
  });

  it('контроль: обычная условная запись той же строки не затронута переходом', async () => {
    table = [{
      user_id: UID, store: 'aiPortrait', key: 'singleton',
      payload: { data: JSON.stringify({ id: 'singleton', summary: 'общее', updatedAt: SERVER_BASE }), updatedAt: SERVER_BASE },
      stamped_at: iso(SERVER_BASE),
    }];
    await localPortrait('моя-правка', Date.parse(table[0]!.stamped_at));

    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);

    expect(res.synced).toBe(1);
    expect(ops.map(o => o.op)).toEqual(['update', 'delete']);
    expect(String(JSON.parse(String(row('singleton')?.payload.data ?? '{}')).summary)).toBe('моя-правка');
  });
});
