import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance, CLOUD_STAMP_STORES } from '../../storage/localDb';
import { AIProfileService } from '../../../features/ai/services/AIProfileService';
import {
  LocalStoreSyncService,
  SUPPORTED_LOCAL_STORES,
  CLOUD_STAMP_FIELD,
} from '../LocalStoreSyncService';

// SF-5 (ревью `sync-step0`): CAS защищает строку только тогда, когда прибор знает,
// от какой облачной версии получена его копия. `_cloudStampedAt` живёт в локальной
// записи, а писатели, которые собирают объект заново, его теряют:
// `AIProfileService.savePortrait` кладёт `{ id, portrait, updatedAt, generatedAtDelta }`.
//
// Без базы `uploadScalar` читает облако и берёт его ТЕКУЩИЙ штамп своей базой:
// условие проходит по построению, и защита остаётся только в окне «чтение → запись».
// То есть более новая чужая версия перетирается молча — «13 из 14 хранилищ под CAS»
// в отчёте SYNC0 было завышенной цифрой.
//
// Правка — перенос отметки в обёртке над `put` (одна точка на все скалярные сторы).
// Тест идёт через настоящего писателя, настоящую IndexedDB, настоящий провайдер и
// настоящий дренаж: подменён только клиент PostgREST.

const UID = 'u_sf5_writer';
const SERVER_BASE = Date.UTC(2026, 9, 17, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

type Row = {
  user_id: string;
  store: string;
  key: string;
  payload: Record<string, unknown>;
  stamped_at: string;
};

let table: Row[];
let ops: Array<{ op: string; key: string; where: string[] }>;
let nextStampMs = SERVER_BASE + 3_600_000;

class Q {
  private f: Array<[string, unknown]> = [];
  private lt_: Array<[string, string]> = [];
  private del = false;
  private ins: Record<string, unknown> | null = null;
  private upd: Record<string, unknown> | null = null;
  private single = false;
  private paged = false;

  select() { return this; }
  insert(row: Record<string, unknown>) { this.ins = row; return this; }
  upsert(row: Record<string, unknown>) { this.ins = row; return this; }
  update(patch: Record<string, unknown>) { this.upd = patch; return this; }
  delete() { this.del = true; return this; }
  eq(col: string, val: unknown) { this.f.push([col, val]); return this; }
  is(col: string, val: unknown) { this.f.push([col, val]); return this; }
  neq() { return this; }
  in(col: string, vals: unknown[]) { this.f.push([col, { __in: vals }]); return this; }
  gt(col: string, val: unknown) { this.lt_.push([`>${col}`, String(val)]); return this; }
  gte(col: string, val: unknown) { this.lt_.push([`>=${col}`, String(val)]); return this; }
  lt(col: string, val: unknown) { this.lt_.push([col, String(val)]); return this; }
  like(col: string, glob: string) { this.f.push([col, { __prefix: glob }]); return this; }
  order() { return this; }
  limit() { return this; }
  range() { this.paged = true; return this; }
  maybeSingle() { this.single = true; return this; }

  then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
    return this.run().then(onFulfilled, onRejected);
  }

  private whereCols(): string[] {
    return this.f.map(([c]) => c).concat(this.lt_.map(([c]) => c));
  }

  private match(r: Row): boolean {
    const rec = r as unknown as Record<string, unknown>;
    for (const [col, val] of this.f) {
      if (val && typeof val === 'object' && '__in' in (val as Record<string, unknown>)) {
        if (!(val as { __in: unknown[] }).__in.includes(rec[col])) return false;
        continue;
      }
      if (val && typeof val === 'object' && '__prefix' in (val as Record<string, unknown>)) {
        const prefix = String((val as { __prefix: string }).__prefix).replace(/%$/, '').replace(/\\([\\%_])/g, '$1');
        if (!String(rec[col]).startsWith(prefix)) return false;
        continue;
      }
      if (rec[col] !== val) return false;
    }
    for (const [col, val] of this.lt_) {
      const mine = Date.parse(r.stamped_at);
      const other = Date.parse(val);
      if (col.startsWith('>=')) { if (!(mine >= other)) return false; continue; }
      if (col.startsWith('>')) { if (!(mine > other)) return false; continue; }
      if (col === 'stamped_at') { if (!(mine < other)) return false; continue; }
      throw new Error(`неизвестный фильтр ${col}`);
    }
    return true;
  }

  private run(): Promise<{ data: unknown; error: unknown }> {
    const id = (one: Record<string, unknown>) => `${String(one.store)}|${String(one.key)}`;

    if (this.upd) {
      const hits = table.filter(r => this.match(r));
      ops.push({ op: 'update', key: hits[0] ? `${hits[0].store}|${hits[0].key}` : '—', where: this.whereCols() });
      for (const r of hits) {
        Object.assign(r, this.upd);
        r.stamped_at = iso(nextStampMs += 1000);
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
        payload: (one.payload ?? {}) as Record<string, unknown>, stamped_at: iso(nextStampMs += 1000),
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
    if (this.paged) hits = hits.slice(0, 1000);
    if (this.single) return Promise.resolve({ data: hits[0] ?? null, error: null });
    return Promise.resolve({ data: hits, error: null });
  }
}

vi.mock('../../../core/supabase/client', () => ({
  getSupabase: () => ({ from: () => new Q(), rpc: () => Promise.resolve({ data: null, error: null }) }),
}));
vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: UID, email: 'u@example.com' }),
  getCurrentUserId: () => UID,
}));
vi.mock('../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  isProfileLoaded: () => true,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
}));
vi.mock('../../../core/crypto/encrypt', () => ({ getSessionKey: () => ({}) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const cloudPortrait = () => {
  const r = table.find(x => x.store === 'aiPortrait' && x.key === 'singleton');
  return r ? String((JSON.parse(String(r.payload.data ?? '{}')) as { portrait?: string }).portrait ?? '') : null;
};

async function readPortrait(): Promise<Record<string, unknown>> {
  const db = await getLocalDb(UID);
  return await db.get('aiPortrait', 'singleton') as unknown as Record<string, unknown>;
}

async function seedPortrait(markdown: string, stamp?: number): Promise<void> {
  const db = await getLocalDb(UID);
  await db.put('aiPortrait', {
    id: 'singleton', portrait: markdown, updatedAt: SERVER_BASE,
    ...(stamp === undefined ? {} : { [CLOUD_STAMP_FIELD]: stamp }),
  } as never);
}

describe('SF-5: писатель скалярного стора не теряет серверную отметку', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ops = [];
    table = [];
    nextStampMs = SERVER_BASE + 3_600_000;
    localStorage.clear();
    sessionStorage.clear();
    resetDbInstance();
    const db = await getLocalDb(UID);
    await db.clear('aiPortrait');
  });

  afterEach(() => { resetDbInstance(); });

  // Мутация: в `putPreservingCloudStamp` вернуть `plain()` (не переносить отметку)
  // → красный на этом же тесте: писатель кладёт объект без служебного поля.
  it('savePortrait поверх принятой облачной версии сохраняет _cloudStampedAt', async () => {
    await seedPortrait('# прежний портрет', SERVER_BASE);

    await AIProfileService.savePortrait('# новый портрет');

    const stored = await readPortrait();
    expect(String(stored.portrait), 'текст писателя записан').toBe('# новый портрет');
    expect(Number(stored[CLOUD_STAMP_FIELD]), 'служебная отметка синхронизации осталась').toBe(SERVER_BASE);
  });

  it('правка писателя не затирает более новую чужую версию облака', async () => {
    await seedPortrait('# прежний портрет', SERVER_BASE);
    await AIProfileService.savePortrait('# мой новый портрет');

    // Другое устройство уже выгрузило свою версию: её отметка новее нашей базы.
    table = [{
      user_id: UID, store: 'aiPortrait', key: 'singleton',
      payload: {
        data: JSON.stringify({ id: 'singleton', portrait: '# чужой портрет', updatedAt: SERVER_BASE + 1000 }),
        updatedAt: SERVER_BASE + 1000,
      },
      stamped_at: iso(SERVER_BASE + 60_000),
    }];

    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);

    expect(res.synced, 'условная запись обязана отказывать, а не перетирать').toBe(0);
    expect(cloudPortrait(), 'чужая версия облака целая').toBe('# чужой портрет');
    expect(String((await readPortrait()).portrait)).toBe('# мой новый портрет');
  });

  it('контроль: новой записи без прежней отметки отметку взять неоткуда', async () => {
    await seedPortrait('# первый');
    expect((await readPortrait())[CLOUD_STAMP_FIELD], 'нет прежней записи — нет и отметки').toBeUndefined();

    table = [];
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);

    expect(res.synced, 'первая выгрузка идёт вставкой, как и раньше').toBe(1);
    expect(ops.map(o => o.op)).toContain('insert');
    expect(Number((await readPortrait())[CLOUD_STAMP_FIELD]), 'принятая вставка принимает отметку сервера')
      .toBeGreaterThan(0);
  });

  it('список под обёрткой = все скалярные сторы синка, кроме диалогов', () => {
    for (const store of SUPPORTED_LOCAL_STORES) {
      if (store === 'aiDialogues') continue;
      expect(CLOUD_STAMP_STORES, `${store} обязан быть под переносом отметки`).toContain(store);
    }
  });
});
