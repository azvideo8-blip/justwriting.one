import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import { parseStampedAt } from '../../data/providers/localStore';
import {
  LocalStoreSyncService,
  getDeadStoreUpserts,
  CLOUD_STAMP_FIELD,
} from '../LocalStoreSyncService';

// S0-1 (F-1): выгрузка скалярного ИИ-стора — запись с условием на СЕРВЕРНУЮ
// отметку той облачной версии, от которой получена локальная копия. До правки
// 13 из 14 сторов уходили слепым `saveLocalStoreRecord` (upsert всего ряда), и
// второе выгрузившееся устройство тихо стирало правку первого — ни форка, ни
// следа в `ai_sync_dead_upserts`.
//
// Харнесс как в `scalarStoreServerStamp.t8.test.ts`: настоящий провайдер
// `localStore`, подменён только клиент PostgREST — правка провайдера и правка
// вызывающего проверяются одним прогоном.
//
// ТОЧНОСТЬ ОТМЕТКИ. Колонка `stamped_at` — `timestamptz` (миграция 0037), то
// есть микросекунды; клиент помнит базу в миллисекундах (`parseStampedAt`).
// Буквальное `.eq('stamped_at', new Date(ms).toISOString())` из тикета не
// сравнялось бы НИ С ОДНОЙ реальной строкой, и CAS отваливал бы каждую выгрузку.
// Поэтому фейк держит отметки с микросекундами и сравнивает их точно: условие
// «облако не ушла дальше моей базовой миллисекунды» проходит, усечённое точное
// равенство — нет.

const UID = 'u_s01_scalar';
const HOUR = 3_600_000;
const SERVER_BASE = Date.UTC(2026, 9, 17, 12, 0, 0);
/** Как MAX_UPSERT_ATTEMPTS в LocalStoreSyncService: на этом проходе правка
 *  уходит в журнал отвергнутых. Не экспортируется — держим число здесь. */
const DEATH_PASS = 6;

type Row = {
  user_id: string;
  store: string;
  key: string;
  payload: Record<string, unknown>;
  stamped_at: string;
};

let table: Row[];
/** Что реально ушло в облако: «что стало» без «что ушло» не отличает отказ от «код не дошёл». */
let ops: Array<{ op: string; key: string; where: string[]; patch?: Record<string, unknown> }>;
/** Исполняется перед вставкой — так чужой ряд появляется между чтением и записью. */
let beforeInsert: (() => void) | undefined;
/** Исполняется СРАЗУ после принятой слепой записи (upsert) — чужой ряд в окне
 *  перечитывания после «оставить моё» (SF3-6). */
let afterUpsert: (() => void) | undefined;
let stampTick = 0;

/** Отметка сервера: доля миллисекунды в микросекундах — не кратна 1000, иначе
 *  усечённый iso совпал бы случайно. Формат как у PostgREST: `…+00:00`, 6 цифр. */
const serverStamp = (ms: number) => {
  const usWithinMs = 100 + ++stampTick * 7;
  return `${new Date(ms).toISOString().replace('Z', '')}${String(usWithinMs).padStart(3, '0')}+00:00`;
};
/** Точный разбор отметки: Date.parse отбрасывает µs-хвост, здесь он значим. */
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
      if (name === 'payload->>updatedAt') { if (!(String(r.payload.updatedAt ?? '') > val)) return false; continue; }
      throw new Error(`неизвестный фильтр ${col}`);
    }
    for (const [col, val] of this.lt_) {
      if (col === 'stamped_at') { if (!(toMicro(r.stamped_at) < toMicro(val))) return false; continue; }
      throw new Error(`неизвестный фильтр ${col}`);
    }
    for (const [col, glob] of this.l) {
      const prefix = glob.replace(/%/g, '').replace(/\\([\\%_])/g, '$1');
      const value = String((r as unknown as Record<string, unknown>)[col]);
      if (!value.startsWith(prefix)) return false;
    }
    return true;
  }

  private find(): Row[] {
    return table.filter((r) => this.matches(r));
  }

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

    if (this.upd) {
      const hits = this.find();
      ops.push({ op: 'update', key: hits.length ? id(hits[0] as unknown as Record<string, unknown>) : '—', where: this.whereCols(), patch: this.upd });
      for (const r of hits) {
        Object.assign(r, this.upd);
        r.stamped_at = serverStamp(SERVER_BASE + 60_000 * (ops.length + 1));
      }
      const data = this.single ? (hits[0] ?? null) : hits;
      return Promise.resolve({ data, error: null });
    }

    if (this.ins) {
      const rows = Array.isArray(this.ins) ? this.ins : [this.ins];
      if (Array.isArray(this.ins)) {
        ops.push({ op: 'upsert-batch', key: rows.map(id).join(','), where: [] });
        for (const row of rows) {
          table = table.filter((r) => !(r.store === row.store && r.key === row.key));
          table.push({
            user_id: String(row.user_id), store: String(row.store), key: String(row.key),
            payload: row.payload as Record<string, unknown>,
            stamped_at: serverStamp(SERVER_BASE + 60_000 * (ops.length + 1)),
          });
        }
        return Promise.resolve({ data: null, error: null });
      }
      const one = this.ins as Record<string, unknown>;
      if (this.write === 'upsert') {
        // ON CONFLICT DO UPDATE: рядом с чужим рядом проходит, а не падает —
        // именно поэтому слепой upsert и стирал чужую правку.
        ops.push({ op: 'upsert', key: id(one), where: [] });
        table = table.filter((r) => !(r.store === one.store && r.key === one.key));
        const replaced: Row = {
          user_id: String(one.user_id), store: String(one.store), key: String(one.key),
          payload: (one.payload ?? {}) as Record<string, unknown>,
          stamped_at: serverStamp(SERVER_BASE + 60_000 * (ops.length + 1)),
        };
        table.push(replaced);
        // SF3-6: чужая запись, приехавшая в окно между нашей слепой записью и
        // перечитыванием.
        const run = afterUpsert;
        afterUpsert = undefined;
        run?.();
        return Promise.resolve({ data: this.single ? replaced : [replaced], error: null });
      }
      beforeInsert?.();
      beforeInsert = undefined;
    afterUpsert = undefined;
      const clash = table.find((r) => r.store === one.store && r.key === one.key);
      if (clash) {
        ops.push({ op: 'insert-rejected', key: id(one), where: this.whereCols() });
        return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique key' } });
      }
      ops.push({ op: 'insert', key: id(one), where: this.whereCols() });
      const inserted: Row = {
        user_id: String(one.user_id), store: String(one.store), key: String(one.key),
        payload: (one.payload ?? {}) as Record<string, unknown>,
        stamped_at: serverStamp(SERVER_BASE + 60_000 * (ops.length + 1)),
      };
      table.push(inserted);
      return Promise.resolve({ data: this.single ? inserted : [inserted], error: null });
    }

    let hits = this.find();
    if (this.del) {
      const doomed = new Set(hits.map((r) => `${r.store}|${r.key}`));
      ops.push({ op: 'delete', key: [...doomed].join(','), where: this.whereCols() });
      table = table.filter((r) => !doomed.has(`${r.store}|${r.key}`));
      return Promise.resolve({ data: null, error: null });
    }
    if (this.__range) hits = hits.slice(this.__range[0], this.__range[1] + 1);
    if (this.single) return Promise.resolve({ data: hits[0] ?? null, error: null });
    return Promise.resolve({ data: hits, error: null });
  }
}

vi.mock('../../supabase/client', () => ({
  getSupabase: () => ({
    from: () => new Q(),
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

const cloudRow = () => table.find((r) => r.store === 'aiPortrait' && r.key === 'singleton');
const cloudSummary = () => JSON.parse(String(cloudRow()?.payload.data ?? '{}')).summary as string | undefined;
/** µs с начала эпохи; отсутствие ряда — ошибка настройки теста, а не «облако пусто». */
const cloudStamp = (): number => {
  const r = cloudRow();
  if (!r) throw new Error('облачного ряда aiPortrait|singleton нет — тест настроен неверно');
  return toMicro(r.stamped_at);
};

/** Ровно те байты, которые продукт кладёт в `payload.data` при выгрузке. */
const portraitJson = (summary: string) => JSON.stringify({ id: 'singleton', summary, updatedAt: SERVER_BASE - HOUR });

/** Облачная версия: содержимое `summary` с серверной отметкой `stampMs`. */
function seedCloud(summary: string, stampMs: number) {
  table = [{
    user_id: UID, store: 'aiPortrait', key: 'singleton',
    payload: { data: portraitJson(summary), updatedAt: stampMs },
    stamped_at: serverStamp(stampMs),
  }];
}

async function localPortrait(value: string, stampBase: number | undefined) {
  const db = await getLocalDb(UID);
  await db.put('aiPortrait', {
    id: 'singleton', summary: value, updatedAt: SERVER_BASE - HOUR,
    ...(stampBase === undefined ? {} : { [CLOUD_STAMP_FIELD]: stampBase }),
  } as never);
  return db;
}

async function readLocal(): Promise<Record<string, unknown>> {
  const db = await getLocalDb(UID);
  return await db.get('aiPortrait', 'singleton') as unknown as Record<string, unknown>;
}

const pushes = () => ops.filter((o) => o.op === 'update' || o.op === 'insert' || o.op === 'upsert');

describe('SF2-7: побочные эффекты точной отметки и бэкапов', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ops = [];
    table = [];
    beforeInsert = undefined;
    afterUpsert = undefined;
    stampTick = 0;
    localStorage.clear();
    resetDbInstance();
    await (await getLocalDb(UID)).clear('aiPortrait');
  });

  afterEach(() => { resetDbInstance(); });

  // SF2-7: проверка CAS держится на том, что `Date.parse` режет микросекундный
  // хвост до миллисекунд. В CI Safari нет, поэтому измерено отдельно на WebKit
  // (playwright webkit-2359, 2026-10-19): `.123456+00:00`, `.123456Z`, `.123+00:00`,
  // `.123456+03:00` — 1792238400123 / 1792238400123 / 1792238400123 / 1792227600123,
  // то есть ровно те же числа, что отдаёт V8: оба движка усекают, а не округляют и
  // не падают в NaN. Тест фиксирует это поведение разборщика (мутация —
  // `Math.round` вместо усечения: доли ≥ 500 мкс начали бы сдвигать базу, и
  // окно CAS `.gte(base).lt(base+1мс)` перестал бы ловить свою же версию).
  it('parseStampedAt режет микросекунды сам, не полагаясь на Date.parse', () => {
    expect(parseStampedAt('2026-10-17T12:00:00.123456+00:00'), 'µs → усечённые ms').toBe(SERVER_BASE + 123);
    expect(parseStampedAt('2026-10-17T12:00:00.123456Z')).toBe(SERVER_BASE + 123);
    expect(parseStampedAt('2026-10-17T12:00:00.5+00:00'), 'одна цифра — десятые доли').toBe(SERVER_BASE + 500);
    expect(parseStampedAt('2026-10-17T12:00:00+00:00'), 'без доли').toBe(SERVER_BASE);
    expect(parseStampedAt('2026-10-17T15:00:00.123456+03:00'), 'смещение +03:00').toBe(SERVER_BASE + 123);
    expect(parseStampedAt(12345), 'число — как было').toBe(12345);
    expect(parseStampedAt('не дата'), 'нечитаемое — undefined, а не 0').toBeUndefined();
  });

  // Мутация: не сносить прежние `…corrupt.<ts>` в healCorruptUpsertJournal →
  // красный (накопленные копии нечитаемого журнала правок никто не подрезает,
  // в отличие от журнала удалений).
  it('бэкапы починки журнала правок подрезаются, как у журнала удалений', async () => {
    const backupKeys = () => Object.keys(localStorage).filter(k => k.startsWith('ai_sync_pending_upserts.corrupt.'));
    const breakJournal = (text: string) => localStorage.setItem(`ai_sync_pending_upserts:${UID}`, text);

    breakJournal('{"не список');
    await LocalStoreSyncService.flushPending(true);
    expect(backupKeys(), 'первая починка оставила копию').toHaveLength(1);

    vi.setSystemTime(Date.now() + 60_000);
    breakJournal('{"всё ещё не список');
    await LocalStoreSyncService.flushPending(true);
    expect(backupKeys(), 'вторая починка снесла прежнюю копию: рой копий в localStorage не живёт').toHaveLength(1);
  });

  // Мутация: убрать ветку «остаток базовой строки старше своих страниц» →
  // красный: CAS по строке не проходит, перечитка даёт старый текст, вечный
  // отказ и `ai_sync_dead_upserts`.
  it('остаток старой строки рядом с более новыми страницами не держит запись в конфликте', async () => {
    const baseStamp = SERVER_BASE;
    const pagesStamp = SERVER_BASE + HOUR;
    table = [
      {
        user_id: UID, store: 'aiPortrait', key: 'singleton',
        payload: { data: portraitJson('остаток-старой-строки'), updatedAt: baseStamp },
        stamped_at: serverStamp(baseStamp),
      },
      {
        user_id: UID, store: 'aiPortrait', key: 'singleton#0',
        payload: { data: portraitJson('версия-страницами'), updatedAt: pagesStamp, page: 0, totalPages: 1 },
        stamped_at: serverStamp(pagesStamp),
      },
    ];

    // Локальная копия получена из страниц — её база это отметка страниц.
    await localPortrait('моя-правка', pagesStamp);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);

    expect(res.synced, 'правка выгружена').toBe(1);
    expect(cloudSummary(), 'облако держит нашу правку одной строкой').toBe('моя-правка');
    expect(getDeadStoreUpserts(UID), 'запись не умерла').toEqual([]);
  });
});

describe('SF3-6: «оставить моё» не присваивает ряд, вклинившийся в окно перечитки', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ops = [];
    table = [];
    beforeInsert = undefined;
    afterUpsert = undefined;
    stampTick = 0;
    localStorage.clear();
    resetDbInstance();
    await (await getLocalDb(UID)).clear('aiPortrait');
  });

  afterEach(() => { resetDbInstance(); });

  // Мутация: вернуть `adoptScalarStamp(… written?.stampedAt ?? null, written?.json ?? localJson)`
  // (принять что угодно, что отдало перечитывание) → красные обе проверки: чужая
  // метка становится нашей базой, и следующий условный проход молча затирает
  // вклинившуюся версию (SF3-6 ровно про это).
  it('чужая запись в окне между слепой записью и перечиткой остаётся чужой', async () => {
    const base = SERVER_BASE;
    seedCloud('версия-B', base + HOUR);
    await localPortrait('моя-правка', base);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    for (let i = 0; i < DEATH_PASS; i++) await LocalStoreSyncService.flushPending(true);
    expect(getDeadStoreUpserts(UID).some(d => d.key === 'singleton'), 'правка ушла в мёртвые').toBe(true);

    // «Отправить всё» пишет вслепую, и в окно до перечитки влезает чужой ряд.
    afterUpsert = () => {
      const mine = table.find(r => r.key === 'singleton');
      if (!mine) throw new Error('слепая запись не дошла до облака — тест настроен неверно');
      table = [{
        ...mine,
        payload: { data: portraitJson('чужая-вклинилась'), updatedAt: mine.payload.updatedAt },
        stamped_at: serverStamp(base + 5 * HOUR),
      }];
    };

    await LocalStoreSyncService.syncAllLocalStores(UID);

    expect(cloudSummary(), 'перечитанное — не наше: принимать его как свою версию нельзя').toBe('чужая-вклинилась');
    expect(Number((await readLocal())[CLOUD_STAMP_FIELD]), 'чужая метка не стала нашей базой').toBe(base);

    // Следующий фоновый проход обязан отказать, а не затереть вклинившуюся версию.
    const res = await LocalStoreSyncService.flushPending(true);
    expect(res.synced, 'правка не выгружена поверх чужой').toBe(0);
    expect(cloudSummary(), 'чужая версия цела').toBe('чужая-вклинилась');
  });
});

describe('S0-1: выгрузка скаляра — условная запись по серверной отметке', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ops = [];
    table = [];
    beforeInsert = undefined;
    afterUpsert = undefined;
    stampTick = 0;
    localStorage.clear();
    resetDbInstance();
    // SF-5: обёртка `put` переносит `_cloudStampedAt` из прежней строки, а
    // fake-indexeddb переживает resetDbInstance — без очистки тестах читали бы
    // отметку предыдущего прогона и «запись без базы» переставала быть без базы.
    await (await getLocalDb(UID)).clear('aiPortrait');
  });

  afterEach(() => { resetDbInstance(); });

  it('RT-1: правка, ушедшая в облако второй, не стирает первую молча', async () => {
    const base = SERVER_BASE;
    seedCloud('общее-исходное', base);

    // Устройство A: правка на основе облачной версии `base`, выгружается первым.
    await localPortrait('с-A', base);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const firstPass = await LocalStoreSyncService.flushPending(true);
    expect(firstPass.synced, 'первая выгрузка обязана пройти').toBe(1);
    expect(cloudSummary()).toBe('с-A');
    const stampAfterA = cloudStamp();

    // Устройство B того же аккаунта: держит ту же базу `base`, правит независимо
    // и выгружается вторым. Раньше его слепой upsert стирал правку A.
    await localPortrait('с-B', base);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    for (let i = 0; i < DEATH_PASS; i++) await LocalStoreSyncService.flushPending(true);

    expect(cloudSummary(), 'облако обязано остаться на правке A').toBe('с-A');
    expect(cloudStamp(), 'ряд не переписан: отметка не сдвинулась').toBe(stampAfterA);
    expect((await readLocal()).summary, 'правка B осталась на устройстве').toBe('с-B');
    expect(
      getDeadStoreUpserts(UID).some((d) => d.store === 'aiPortrait' && d.key === 'singleton'),
      'отвергнутая правка видна в журнале отвергнутых, а не исчезла молча',
    ).toBe(true);
  });

  it('контроль: без чужой выгрузки та же правка уходит одним условным обновлением', async () => {
    const base = SERVER_BASE;
    seedCloud('общее-исходное', base);
    await localPortrait('только-моя', base);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);

    expect(res.synced).toBe(1);
    expect(cloudSummary()).toBe('только-моя');
    expect(pushes()).toHaveLength(1);
    expect(pushes()[0]!.op).toBe('update');
    expect(pushes()[0]!.where, 'условие — по серверной отметке ряда').toContain('stamped_at');
  });

  it('RT-1/мутация: успешная выгрузка запоминает новую серверную отметку (F-2)', async () => {
    const base = SERVER_BASE;
    seedCloud('общее-исходное', base);
    await localPortrait('моя-правка', base);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    await LocalStoreSyncService.flushPending(true);

    const adopted = await readLocal();
    expect(typeof adopted[CLOUD_STAMP_FIELD], 'скаляр после выгрузки обязан принять отметку сервера').toBe('number');
    expect(Number(adopted[CLOUD_STAMP_FIELD])).toBeGreaterThanOrEqual(base + 60_000 - 1);
    expect(Number(adopted[CLOUD_STAMP_FIELD])).toBeLessThan(cloudStamp() / 1000 + 1);
  });

  it('запись без базы: облако перечитано, условие поставлено по его отметке', async () => {
    seedCloud('чужая-версия', SERVER_BASE);
    await localPortrait('моя-без-базы', undefined);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);

    expect(pushes()).toHaveLength(1);
    expect(pushes()[0]!.where).toContain('stamped_at');
    expect(res.synced).toBe(1);
    expect(cloudSummary()).toBe('моя-без-базы');
  });

  it('облако держит ровно эту копию — ни одной записи, отметка принята', async () => {
    seedCloud('одинаковое', SERVER_BASE);
    await localPortrait('одинаковое', undefined);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);

    expect(pushes(), 'запись не нужна: она ставила бы ряду новую отметку на каждом проходе').toHaveLength(0);
    expect(res.synced).toBe(1);
    expect(Number((await readLocal())[CLOUD_STAMP_FIELD])).toBeGreaterThanOrEqual(SERVER_BASE);
  });

  it('в облаке строки нет — уходит insert, а не слепой upsert всего ряда', async () => {
    table = [];
    await localPortrait('первая-версия', undefined);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);

    expect(res.synced).toBe(1);
    expect(pushes().map((p) => p.op)).toEqual(['insert']);
  });

  it('ряд появился между чтением и вставкой — 23505 это конфликт, а не затирание', async () => {
    await localPortrait('моя-правка', undefined);
    // Пока читали облако (пусто), другое устройство успело вставить свой ряд.
    beforeInsert = () => {
      table = [{
        user_id: UID, store: 'aiPortrait', key: 'singleton',
        payload: { data: portraitJson('чужая-вклинилась'), updatedAt: SERVER_BASE },
        stamped_at: serverStamp(SERVER_BASE),
      }];
    };
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);

    expect(res.synced, 'вставленная чужая версия не затёрта').toBe(0);
    expect(cloudSummary()).toBe('чужая-вклинилась');
    expect(ops.map((o) => o.op)).toContain('insert-rejected');
    expect(pushes(), 'после отказа повторной слепой записи нет').toHaveLength(0);
  });

  it('постраничные скаляры `key#N` остаются слепыми — разрешение тикета, не регресс', async () => {
    // У группы страниц нет базовой строки, отметку сравнивать не с чем (тот же
    // класс, что M-1 у диалогов). Тикет разрешает оставить ветку слепой с
    // комментарием и тикетом в отчёте.
    const big = 'x'.repeat(600 * 1024);
    const db = await getLocalDb(UID);
    await db.put('aiPortrait', { id: 'singleton', summary: big, updatedAt: SERVER_BASE } as never);
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);

    expect(res.synced).toBe(1);
    expect(ops.some((o) => o.op === 'upsert-batch')).toBe(true);
  });
});
