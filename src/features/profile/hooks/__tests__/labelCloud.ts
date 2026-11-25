// LB-1: подделка облака для тестов меток — на уровне клиента supabase, так что
// настоящий провайдер (profiles.ts) с его условием записи работает в тестах целиком.
// Понимает ровно то, что провайдер шлёт про users: select/update, фильтр eq по
// колонке, возврат строк, и системную версию строки xmin: её меняет любая запись
// (в том числе чужая — `put`), отдаётся она только когда названа в select.
// Что PostgREST отвечает на те же запросы так же — проверено на стенде (отчёт LB-1).
// Задержки управляются: чтение снимает строку и потом ждёт (ответ в пути),
// запись ждёт и потом применяется (запрос в пути), ack — ответ на применённую запись.

type Row = Record<string, unknown>;
type Kind = 'read' | 'write' | 'ack';
type Filter = { column: string; value: unknown };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function createLabelCloud() {
  const rows = new Map<string, Row>();
  const versions = new Map<string, number>();
  let clock = 1000;
  /** Любая запись в строку — наша, другого устройства, прежнего клиента — меняет её версию. */
  const put = (uid: string, row: Row) => { rows.set(uid, row); versions.set(uid, ++clock); };
  const matches = (row: Row, f: Filter) =>
    String(f.column === 'xmin' ? versions.get(String(row.uid)) : row[f.column]) === String(f.value);
  const calls = { read: 0, write: 0 };
  let holds: Array<{ kind: Kind; wait: Promise<void> }> = [];
  let failures: Array<{ kind: Kind; error: Error; skip: number }> = [];
  let jitter: (() => Promise<void>) | null = null;
  // Счётчик незавершённых вызовов — свой у каждого теста: вызов, намеренно
  // оставленный висеть в прошлом тесте, не держит idle() следующего.
  let live = { pending: 0 };

  const transit = async (kind: Kind) => {
    const f = failures.findIndex(x => x.kind === kind);
    if (f >= 0 && failures[f]!.skip-- <= 0) throw failures.splice(f, 1)[0]!.error;
    const h = holds.findIndex(x => x.kind === kind);
    if (h >= 0) await holds.splice(h, 1)[0]!.wait;
    if (jitter) await jitter();
  };

  const tracked = async (fn: () => Promise<unknown>): Promise<{ data: unknown; error: unknown }> => {
    const mine = live;
    mine.pending++;
    try { return { data: await fn(), error: null }; }
    catch (error) { return { data: null, error }; }
    finally { mine.pending--; }
  };

  const found = (filters: Filter[]) => [...rows.values()].filter(r => filters.every(f => matches(r, f)));

  function users() {
    const filters: Filter[] = [];
    let patch: Row | null = null;
    let columns = '*';
    const run = (single: boolean) => tracked(async () => {
      if (!patch) {
        calls.read++;
        if (jitter) await jitter();
        const snapshot = clone(found(filters)).map(r => (columns.includes('xmin') ? { ...r, xmin: String(versions.get(String(r.uid))) } : r));
        await transit('read');
        return single ? snapshot[0] ?? null : snapshot;
      }
      calls.write++;
      await transit('write');
      const hit = found(filters);
      for (const row of hit) put(String(row.uid), { ...row, ...clone(patch) });
      if (hit.length > 0) await transit('ack');
      return hit.map(r => ({ uid: r.uid }));
    });
    const b = {
      select: (cols?: string) => { if (!patch && cols) columns = cols; return b; },
      update: (data: Row) => { patch = data; return b; },
      eq: (column: string, value: unknown) => { filters.push({ column, value }); return b; },
      maybeSingle: () => run(true),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => run(false).then(ok, bad),
    };
    return b;
  }

  // Прочие таблицы (зачистка метки в заметках) — пустой успешный ответ.
  const other = (): Record<string, unknown> => new Proxy({}, {
    get: (_t, prop) => prop === 'then'
      ? (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok)
      : () => other(),
  });

  return {
    client: { from: (table: string) => (table === 'users' ? users() : other()) },
    rows,
    put,
    calls,
    labels: (uid: string) => (rows.get(uid)?.labels ?? []) as Row[],
    /** Следующий вызов этого вида застревает в пути, пока не вызван возвращённый release. */
    hold(kind: Kind): () => void {
      let release!: () => void;
      holds.push({ kind, wait: new Promise<void>(r => { release = r; }) });
      return release;
    },
    /** Следующий вызов этого вида (после `skip` удачных) падает. */
    failNext(kind: Kind, error: Error, skip = 0) { failures.push({ kind, error, skip }); },
    setJitter(fn: (() => Promise<void>) | null) { jitter = fn; },
    /** Ждёт, пока в облаке не останется незавершённых вызовов (разовые проходы идут без ожидания). */
    async idle() {
      for (let quiet = 0; quiet < 3;) {
        await new Promise(r => setTimeout(r, 0));
        quiet = live.pending === 0 ? quiet + 1 : 0;
      }
    },
    reset() {
      live = { pending: 0 }; rows.clear(); versions.clear(); calls.read = 0; calls.write = 0; holds = []; failures = []; jitter = null;
    },
  };
}

export const cloud = createLabelCloud();
