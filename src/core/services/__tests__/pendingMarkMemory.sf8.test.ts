import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import {
  LocalStoreSyncService,
  getPendingUpsertKeySet,
  CLOUD_STAMP_FIELD,
} from '../LocalStoreSyncService';
import { reportError } from '../../../shared/errors/reportError';

// SF-8 (ревью `sync-step0`), часть про очередь правок: `persistUpserts` при
// НЕЧИТАЕМОМ журнале молча выходил, не поставив отметку. Обязательство «эта
// запись ждёт выгрузки» исчезало вместе с ним, а S0-3 на заборе читает отсутствие
// отметки как «невыгруженной правки нет» и отдаёт облако. Вкладка, закрытая до
// починки битого JSON, — правка перезаписана облачной копией. Класс тот же, что
// SF-1/SF-3, но вход в него — не отказ сервера, а нечитаемый журнал.
//
// Правка: отметку держим в памяти аккаунта и сообщаем об этом в журнал ошибок;
// в союз для спора копий она входит сразу, а в журнал на диске — как только он
// снова читается (следующий `persistUpserts` или начало дренажа).
//
// SF-8, часть про флаг: `.scoped.v1` писался в трёх местах и не читался ни в
// одном, а отчёт описывал откат пакета как «снять флаг». Флаг убран из кода;
// проверка ниже требует, чтобы чтение журнала не рисовало служебных ключей.

// Память-отметки (SF-8) живут в модуле сервиса и переживают тесты, поэтому каждый
// тест идёт под своим uid: иначе «carry из памяти» предыдущего прогона приехал бы в
// этот как собственная отметка. Фаберикам vi.mock нужен доступ к нему до инициализации
// модуля — отсюда vi.hoisted.
const ctx = vi.hoisted(() => ({ uid: 'u_sf8_a', n: 0 }));
const UID = () => ctx.uid;
const SERVER_BASE = Date.UTC(2026, 9, 17, 12, 0, 0);
const journalKey = () => 'ai_sync_pending_upserts:' + ctx.uid;

type Row = {
  user_id: string;
  store: string;
  key: string;
  payload: Record<string, unknown>;
  stamped_at: string;
};

let table: Row[];
let ops: Array<{ op: string; key: string }>;

const iso = (ms: number) => new Date(ms).toISOString();

class Q {
  private f: Array<[string, unknown]> = [];
  private lt_: Array<[string, string]> = [];
  private ins: Record<string, unknown> | null = null;
  private upd: Record<string, unknown> | null = null;
  private single = false;

  select() { return this; }
  insert(row: Record<string, unknown>) { this.ins = row; return this; }
  upsert(row: Record<string, unknown>) { this.ins = row; return this; }
  update(patch: Record<string, unknown>) { this.upd = patch; return this; }
  delete() { return this; }
  eq(col: string, val: unknown) { this.f.push([col, val]); return this; }
  is(col: string, val: unknown) { this.f.push([col, val]); return this; }
  in(col: string, vals: unknown[]) { this.f.push([col, { __in: vals }]); return this; }
  gt(col: string, val: unknown) { this.lt_.push([`>${col}`, String(val)]); return this; }
  gte(col: string, val: unknown) { this.lt_.push([`>=${col}`, String(val)]); return this; }
  lt(col: string, val: unknown) { this.lt_.push([col, String(val)]); return this; }
  like(col: string, glob: string) { this.f.push([col, { __prefix: glob }]); return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  maybeSingle() { this.single = true; return this; }

  then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
    return this.run().then(onFulfilled, onRejected);
  }

  private match(r: Row): boolean {
    const rec = r as unknown as Record<string, unknown>;
    for (const [col, val] of this.f) {
      if (val && typeof val === 'object' && '__in' in (val as Record<string, unknown>)) {
        if (!(val as { __in: unknown[] }).__in.includes(rec[col])) return false;
        continue;
      }
      if (val && typeof val === 'object' && '__prefix' in (val as Record<string, unknown>)) {
        const prefix = String((val as { __prefix: string }).__prefix).replace(/%$/, '');
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
    if (this.upd) {
      const hits = table.filter(r => this.match(r));
      ops.push({ op: 'update', key: hits[0] ? `${hits[0].store}|${hits[0].key}` : '—' });
      for (const r of hits) {
        Object.assign(r, this.upd);
        r.stamped_at = iso(SERVER_BASE + 60_000 * (ops.length + 1));
      }
      return Promise.resolve({ data: this.single ? (hits[0] ? { stamped_at: hits[0].stamped_at } : null) : hits, error: null });
    }
    if (this.ins) {
      const one = this.ins;
      if (table.find(r => r.store === one.store && r.key === one.key)) {
        ops.push({ op: 'insert-rejected', key: `${String(one.store)}|${String(one.key)}` });
        return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
      }
      ops.push({ op: 'insert', key: `${String(one.store)}|${String(one.key)}` });
      const inserted: Row = {
        user_id: String(one.user_id), store: String(one.store), key: String(one.key),
        payload: (one.payload ?? {}) as Record<string, unknown>, stamped_at: iso(SERVER_BASE + 60_000),
      };
      table.push(inserted);
      return Promise.resolve({ data: this.single ? { stamped_at: inserted.stamped_at } : [inserted], error: null });
    }
    const hits = table.filter(r => this.match(r));
    if (this.single) return Promise.resolve({ data: hits[0] ?? null, error: null });
    return Promise.resolve({ data: hits, error: null });
  }
}

vi.mock('../../supabase/client', () => ({
  getSupabase: () => ({ from: () => new Q(), rpc: () => Promise.resolve({ data: null, error: null }) }),
}));
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: ctx.uid, email: 'u@example.com' }),
  getCurrentUserId: () => ctx.uid,
}));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
}));
vi.mock('../../crypto/encrypt', () => ({ getSessionKey: () => ({}) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const cloudPortrait = () => {
  const r = table.find(x => x.store === 'aiPortrait' && x.key === 'singleton');
  return r ? String((JSON.parse(String(r.payload.data ?? '{}')) as { summary?: string }).summary ?? '') : null;
};

describe('SF-8: нечитаемый журнал не имеет права потерять отметку', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ops = [];
    table = [];
    // Память-отметки живут в модуле сервиса: новый uid на тест, иначе отметка
    // предыдущего прогона приехала бы в этот как своя.
    ctx.uid = 'u_sf8_' + (++ctx.n);
    localStorage.clear();
    sessionStorage.clear();
    resetDbInstance();
    const db = await getLocalDb(UID());
    await db.clear('aiPortrait');
  });

  afterEach(() => { resetDbInstance(); });

  it('отметка переживает нечитаемый журнал и уезжает в облако после его починки', async () => {
    localStorage.setItem(journalKey(), '{битый');
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');

    expect(getPendingUpsertKeySet(ctx.uid),
      'журнал не читается, но обязательство живёт в памяти — «нет правки» тут неправда').toBeNull();
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'persistUpserts_memoryFallback' }),
      'warning',
    );

    const db = await getLocalDb(UID());
    await db.put('aiPortrait', {
      id: 'singleton', summary: 'правка без журнала', updatedAt: SERVER_BASE, [CLOUD_STAMP_FIELD]: SERVER_BASE,
    } as never);
    // Облачная версия, от которой получена локальная копия: база есть, значит
    // выгрузка идёт условным обновлением, а не вставкой.
    table = [{
      user_id: ctx.uid, store: 'aiPortrait', key: 'singleton',
      payload: {
        data: JSON.stringify({ id: 'singleton', summary: 'прежняя версия', updatedAt: SERVER_BASE - 1000 }),
        updatedAt: SERVER_BASE - 1000,
      },
      stamped_at: iso(SERVER_BASE),
    }];

    // Журнал починили — отметка из памяти обязана уехать в него и в облако.
    localStorage.setItem(journalKey(), '[]');
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending(true);

    expect(res.synced, 'правка выгружена').toBe(1);
    expect(cloudPortrait()).toBe('правка без журнала');
    expect(getPendingUpsertKeySet(ctx.uid)?.has('aiPortrait:singleton'),
      'обязательство закрыто и снята не только память').toBe(false);
    expect(JSON.parse(localStorage.getItem(journalKey()) ?? '[]'), 'в журнале на диске тоже пусто').toEqual([]);
  });

  it('память-отметка попадает в союз для спора копий, когда журнал снова читается, но её ещё не успели дописать', async () => {
    localStorage.setItem(journalKey(), '{битый');
    LocalStoreSyncService.scheduleStoreSync('aiPersonas', 'p1');
    // Правильный ответ здесь — `null` («журнал не читается»), и забор оставляет
    // локальное. Но память обязана держать ключ, иначе после починки журнал
    // скажет «правок нет».
    expect(getPendingUpsertKeySet(ctx.uid)).toBeNull();
    localStorage.setItem(journalKey(), '[]');
    expect(getPendingUpsertKeySet(ctx.uid)?.has('aiPersonas:p1'),
      'починили журнал — отметка всё ещё с нами').toBe(true);
  });

  it('чтение журнала не рисует служебных ключей (флаг переноса из кода убран)', async () => {
    expect(localStorage.getItem(journalKey())).toBeNull();
    expect(getPendingUpsertKeySet(ctx.uid)?.size).toBe(0);
    const flags = Object.keys(localStorage).filter(k => k.includes('.scoped.v1'));
    expect(flags, 'флаг, который никто не читает, — не механизм отката').toEqual([]);
  });

  it('контроль: читаемый журнал пишет отметку на диск, как раньше', async () => {
    localStorage.setItem(journalKey(), '[]');
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    expect(JSON.parse(localStorage.getItem(journalKey()) ?? '[]')).toEqual([
      { uid: ctx.uid, store: 'aiPortrait', key: 'singleton' },
    ]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('контроль: отметка не duplicate, когда её ставили и в памяти, и на диске', async () => {
    localStorage.setItem(journalKey(), '[]');
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    localStorage.setItem(journalKey(), '{битый');
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    localStorage.setItem(journalKey(), '[]');
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');

    const rows = JSON.parse(localStorage.getItem(journalKey()) ?? '[]') as unknown[];
    expect(rows, 'одна запись на одну правку').toHaveLength(1);
  });
});
