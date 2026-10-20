import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveLocalStoreRecordIfUnstamped } from '../localStore';

// SF-6 (ревью `sync-step0`): условие условной скалярной записи — только «метка ряда
// не ушла вперёд от моей базы» (`.lt(stamped_at, база+1мс)`). Оно пропускает и ряд,
// который СТАРШЕ базы: серверные часы перевели назад, или транзакция, начатая раньше,
// закоммитилась позже. Для такой строки CAS сегодня проходит и запись перетирает
// версию, которой мы не видели, — то есть ровно то, ради чего CAS вводился.
//
// Правка: точное равенство в пределах миллисекунды — `.gte(база).lt(база+1мс)`.
// Окно при этом не меняется: µs-хвост реального `timestamptz` всё ещё усечён
// базой, поэтому «та же миллисекунда» обязана проходить. Проверяется на настоящем
// провайдере: подменён только клиент PostgREST, фильтры сравниваются с микросекундами.

const UID = 'u_sf6_window';
const HOUR = 3_600_000;
const BASE = Date.UTC(2026, 9, 17, 12, 0, 0);

let rowStamp: string | null;
let filters: string[];
let wrote = false;

/** Как `timestamptz`: 6 цифр дробной части и `+00:00`. */
const us = (ms: number, usWithin: number) =>
  `${new Date(ms).toISOString().replace('Z', '')}${String(usWithin).padStart(6, '0')}+00:00`;
const toMicro = (v: string): number => {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m) return Date.parse(v) * 1000;
  return Date.parse(`${m[1]}.000${m[3]}`) * 1000 + Number((m[2] ?? '').padEnd(6, '0').slice(0, 6));
};

class Q {
  private f: Array<[string, unknown]> = [];
  private bounds: Array<[string, string, number]> = [];
  private single = false;

  select() { return this; }
  insert(row: Record<string, unknown>) { this.f.push(['insert', row]); return this; }
  update(patch: Record<string, unknown>) { this.f.push(['patch', patch]); return this; }
  eq(col: string, val: unknown) { this.f.push([col, val]); return this; }
  maybeSingle() { this.single = true; return this; }

  /** PostgREST: `col=gte.X` и `col=lt.X` — нижняя и верхняя границы одного окна. */
  gte(col: string, val: unknown) { this.bounds.push([col, '>=', toMicro(String(val))]); filters.push(`gte:${col}`); return this; }
  lt(col: string, val: unknown) { this.bounds.push([col, '<', toMicro(String(val))]); filters.push(`lt:${col}`); return this; }
  gt(col: string, val: unknown) { this.bounds.push([col, '>', toMicro(String(val))]); filters.push(`gt:${col}`); return this; }

  then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
    return this.run().then(onFulfilled, onRejected);
  }

  private run(): Promise<{ data: unknown; error: unknown }> {
    const patch = this.f.find(([c]) => c === 'patch');
    const inserted = this.f.find(([c]) => c === 'insert');
    const accept = (): { data: unknown; error: unknown } => {
      wrote = true;
      rowStamp = us(BASE + HOUR, 500_000);
      const body = { stamped_at: rowStamp };
      return { data: this.single ? body : [body], error: null };
    };
    const refuse = (): { data: unknown; error: unknown } => ({ data: this.single ? null : [], error: null });

    if (inserted && !patch) {
      if (rowStamp !== null) {
        return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique key' } });
      }
      return Promise.resolve(accept());
    }
    if (!patch) return Promise.resolve({ data: null, error: null });
    if (rowStamp === null) return Promise.resolve(refuse());

    const mine = toMicro(rowStamp);
    const passes = this.bounds.every(([col, op, val]) => col === 'stamped_at'
      && (op === '>=' ? mine >= val : op === '>' ? mine > val : mine < val));
    return Promise.resolve(passes ? accept() : refuse());
  }
}

vi.mock('../../../supabase/client', () => ({
  getSupabase: () => ({ from: () => new Q(), rpc: () => Promise.resolve({ data: null, error: null }) }),
}));

describe('SF-6: условие CAS — точное равенство в пределах миллисекунды', () => {
  beforeEach(() => {
    filters = [];
    wrote = false;
    rowStamp = null;
  });

  // Мутация: снять `.gte(base)` (оставить только `.lt(base+1ms)`) → красный.
  it('ряд СТАРШЕ базы не проходит условие: часы сервера отвели назад — это конфликт', async () => {
    rowStamp = us(BASE - 60_000, 123_456);
    const res = await saveLocalStoreRecordIfUnstamped(UID, 'aiPortrait', 'singleton', { data: '{}' }, BASE);

    expect(res.written, 'запись поверх более старой строки запрещена').toBe(false);
    expect(wrote).toBe(false);
    expect(filters).toContain('gte:stamped_at');
  });

  it('та же миллисекунда — условие проходит: усечённая база не создаёт ложных отказов', async () => {
    rowStamp = us(BASE, 986_543);
    const res = await saveLocalStoreRecordIfUnstamped(UID, 'aiPortrait', 'singleton', { data: '{}' }, BASE);

    expect(res.written, 'ровно моя версия (µs-хвост усечён базой) обязана приниматься').toBe(true);
    if (res.written) expect(Number(res.stampedAt)).toBeGreaterThan(BASE);
  });

  it('метка на сутки вперёд — отказ', async () => {
    rowStamp = us(BASE + HOUR, 111_111);
    const res = await saveLocalStoreRecordIfUnstamped(UID, 'aiPortrait', 'singleton', { data: '{}' }, BASE);
    expect(res.written).toBe(false);
  });

  it('следующая миллисекунда — уже отказ (окно ровно в 1 мс)', async () => {
    rowStamp = us(BASE + 1, 0);
    const res = await saveLocalStoreRecordIfUnstamped(UID, 'aiPortrait', 'singleton', { data: '{}' }, BASE);
    expect(res.written).toBe(false);
  });

  it('базы нет — вставка, а не условное обновление', async () => {
    rowStamp = null;
    const res = await saveLocalStoreRecordIfUnstamped(UID, 'aiPortrait', 'singleton', { data: '{}' }, null);
    expect(filters, 'условия по stamped_at не было').not.toContain('gte:stamped_at');
    expect(res.written).toBe(true);
  });
});
