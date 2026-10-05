import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLocalStoreRecords } from '../providers/localStore';

// V-4.2: инкрементальный забор диалогов сравнивает СЕРВЕРНУЮ отметку строки
// (миграция 0037), а не `payload.updatedAt`. Дочерние строки — страницы `key#…`
// старых клиентов и окна `key@seg…` — триггер не переставляет, и на часах
// устройства, отстающих на два часа, такие строки не попадали в `> since` и не
// доезжали до суток.

type Row = {
  user_id: string;
  store: string;
  key: string;
  payload: Record<string, unknown>;
  stamped_at: string;
};

const UID = 'u_pull_clock';
const HOUR = 3_600_000;
const SERVER_NOW = Date.UTC(2026, 9, 5, 12, 0, 0);

let table: Row[];
let calls: string[];

function iso(ms: number): string { return new Date(ms).toISOString(); }

const builder = {
  select() { return this; },
  eq(col: string, val: unknown) {
    calls.push(`eq:${col}`);
    table = table.filter(r => (r as unknown as Record<string, unknown>)[col] === val);
    return this;
  },
  gt(col: string, val: unknown) {
    calls.push(`gt:${col}=${String(val)}`);
    table = table.filter(r => {
      if (col === 'stamped_at') return r.stamped_at > String(val);
      if (col === 'payload->>updatedAt') return String((r.payload.updatedAt as number | undefined) ?? '') > String(val);
      throw new Error(`неизвестный фильтр ${col}`);
    });
    return this;
  },
  order(col: string) {
    calls.push(`order:${col}`);
    table = [...table].sort((a, b) => String(a[col as keyof Row]).localeCompare(String(b[col as keyof Row])));
    return this;
  },
  range(from: number, to: number) {
    calls.push(`range:${from}:${to}`);
    const rows = table.slice(from, to + 1);
    // Повторный вызов должен отдать пустую страницу, иначе pageAll зациклится.
    table = [];
    return Promise.resolve({ data: rows, error: null });
  },
};

vi.mock('../../supabase/client', () => ({
  getSupabase: () => ({ from: () => builder }),
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

beforeEach(() => {
  calls = [];
  // Курсор другого устройства: серверная отметка +2 ч, а часы этого устройства
  // отстают на два часа, и payload.updatedAt его строк — вчерашнего времени.
  const deviceBehind = SERVER_NOW - 2 * HOUR;
  table = [
    {
      user_id: UID, store: 'aiDialogues', key: 'dlg-1',
      payload: { head: true, updatedAt: SERVER_NOW },
      stamped_at: iso(SERVER_NOW),
    },
    {
      // Страница, выгруженная устройством с убегшими назад часами: сервер принял
      // её СЕЙЧАС, а внутри лежит device-ная отметка двухчасовой давности.
      user_id: UID, store: 'aiDialogues', key: 'dlg-1#1759000000000#abcd#p0',
      payload: { chunk: '…', updatedAt: deviceBehind, page: 0, totalPages: 1 },
      stamped_at: iso(SERVER_NOW),
    },
    {
      user_id: UID, store: 'aiPortrait', key: 'singleton',
      payload: { updatedAt: SERVER_NOW },
      stamped_at: iso(SERVER_NOW),
    },
  ];
});

describe('инкрементальный забор local_store_records (V-4.2)', () => {
  it('диалоги фильтруются по stamped_at, а не по отметке из payload', async () => {
    const since = SERVER_NOW - HOUR; // курсор устройства, которое на час впереди жертвы
    const rows = await getLocalStoreRecords(UID, 'aiDialogues', since);

    expect(calls.filter(c => c.startsWith('gt:'))).toEqual([`gt:stamped_at=${iso(since)}`]);
    // Дочерняя строка с device-ной отметкой в два часа назад обязана попасть в выборку.
    expect(rows.map(r => r.key)).toContain('dlg-1#1759000000000#abcd#p0');
  });

  it('остальные сторы фильтруются так же — по stamped_at (W-3)', async () => {
    // Раньше этот кейс закреплял обратное (`payload.updatedAt`), и ровно поэтому
    // прод ничего не заметил: единственный инкрементальный вызывающий передаёт
    // store = undefined, так что ветка «по отметке из payload» исполнялась и для
    // диалогов тоже.
    const rows = await getLocalStoreRecords(UID, 'aiPortrait', SERVER_NOW - HOUR);
    expect(calls.filter(c => c.startsWith('gt:'))).toEqual([`gt:stamped_at=${iso(SERVER_NOW - HOUR)}`]);
    expect(rows.map(r => r.key)).toEqual(['singleton']);
  });

  it('без курсора — полный забор, фильтров по времени нет', async () => {
    const rows = await getLocalStoreRecords(UID, 'aiDialogues');
    expect(calls.some(c => c.startsWith('gt:'))).toBe(false);
    expect(rows.length).toBe(2);
  });

  it('отметка сервера доходит до читателя в мс (parseStampedAt)', async () => {
    const rows = await getLocalStoreRecords(UID, 'aiDialogues');
    expect(rows.find(r => r.key === 'dlg-1')?.stamped_at).toBe(SERVER_NOW);
  });
});
