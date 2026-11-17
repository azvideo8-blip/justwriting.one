/**
 * In-Memory Postgres Store for Fault-Injection Testing
 *
 * Implements a stateful, in-memory relational store that emulates Supabase/Postgres
 * tables, constraints, and query builder semantics for testing product services
 * without network calls.
 */

export interface PostgresRow {
  [key: string]: unknown;
}

export type TableName =
  | 'documents'
  | 'versions'
  | 'drafts'
  | 'users'
  | 'ai_summaries'
  | 'ai_embeddings'
  | 'local_store_records';

export interface QueryFilter {
  type: 'eq' | 'is' | 'in' | 'not' | 'gt' | 'gte' | 'lt' | 'lte' | 'like';
  column: string;
  value: unknown;
  operator?: string;
}

export interface QueryOrder {
  column: string;
  ascending: boolean;
}

const TABLE_COLUMNS: Record<TableName, readonly string[]> = {
  documents: ['id', 'uuid', 'user_id', 'title', 'content', 'created_at', 'updated_at', 'deleted_at', 'rev'],
  versions: ['id', 'document_uuid', 'user_id', 'version', 'content', 'created_at', 'rev'],
  drafts: ['id', 'user_id', 'content', 'created_at', 'updated_at', 'rev'],
  users: ['id', 'uid', 'email', 'encryption_meta', 'created_at'],
  ai_summaries: ['id', 'document_id', 'user_id', 'summary', 'created_at'],
  ai_embeddings: ['id', 'document_id', 'user_id', 'dim', 'created_at'],
  // SF2-4 (перенос S0-7): `stamped_at` — серверная метка ряда из миграции 0037.
  // Без неё стенд не видел ни CAS скалярной выгрузки, ни инкрементального забора
  // ИИ-данных: оба решаются отметкой сервера, и на голых `updated_at` харнес
  // молчал там, где прод отказывает.
  // S1-3: `rev` — номер строки из 0045; один счётчик на четыре таблицы.
  // S2-3: `deleted` — надгробие из 0047, клиенту не видно (политика select).
  local_store_records: ['id', 'user_id', 'store', 'key', 'payload', 'checksum', 'created_at', 'updated_at', 'stamped_at', 'rev', 'deleted'],
};

/** S2-3: элемент и ответ `sync_push` (0047). */
export type SyncPushItem = Record<string, unknown>;
export interface SyncPushResult {
  status: 'ok' | 'conflict' | 'duplicate' | 'missing' | 'gone' | 'rejected';
  rev?: number | null;
  stamped_at?: number;
  payload_updated_at?: unknown;
  row?: { rev: number; deleted: boolean; payload: unknown; checksum: unknown; stamped_at: number } | null;
}

/** Надгробие `local_store_records` для клиента — как удалённая строка (0047). */
function isTombstone(table: TableName, row: PostgresRow): boolean {
  return table === 'local_store_records' && row.deleted === true;
}

// R4-029: уникальные кортежи — по реальной схеме (0001_schema.sql,
// 0003_local_store_records.sql). Одни и те же кортежи принудительны и для
// insert, и для upsert: раньше insert стерёг только documents.uuid и versions,
// и подмена .upsert на .insert в провайдере проходила по матрице незамеченной.
// Счётчики квот харнес не пишет, но кортежи их держим для полноты схемы.
type TupleTable = TableName | 'ai_cooldown' | 'ai_daily_limit' | 'ai_usage' | 'ai_global_daily';
const UNIQUE_TUPLES: Partial<Record<TupleTable, (row: PostgresRow) => string>> = {
  users: r => `uid:${r.uid}`,
  documents: r => `uuid:${r.uuid}`,
  versions: r => `ver:${r.document_uuid}:${r.version}`,
  drafts: r => `draft:${r.user_id}`,
  ai_cooldown: r => `cd:${r.uid}`,
  ai_daily_limit: r => `dl:${r.uid}:${r.date}`,
  ai_usage: r => `au:${r.uid}:${r.date}`,
  ai_global_daily: r => `gd:${r.date}`,
  ai_summaries: r => `sum:${r.user_id}:${r.document_id}`,
  ai_embeddings: r => `emb:${r.user_id}:${r.document_id}`,
  local_store_records: r => `lsr:${r.user_id}:${r.store ?? r.store_name}:${r.key ?? r.record_key}`,
};

/** Серверная метка прода — строка ISO-8601 (`timestamptz`), её и сравниваем. */
const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function duplicateError(table: TableName) {
  return {
    data: null as null,
    error: {
      message: `duplicate key value violates unique constraint "${table}_key"`,
      code: '23505',
    },
  };
}

export class InMemoryPostgres {
  public tables: Map<TableName, PostgresRow[]> = new Map();
  private sequences: Map<string, number> = new Map();
  /** S1-3: база без 0045. Запрос, который трогает `rev`, отвечает 42703 —
   *  как PostgREST на таблице без этой колонки. */
  public withRev: boolean;
  /** S1-3: как `PGRST_DB_MAX_ROWS` у PostgREST — режет и `limit`, и `range`. */
  public maxRows: number;
  /** S1-3: один номер на все четыре таблицы, как `sync_rev_seq`. */
  private revSeq = 0;
  /** S1-3: «сколько запросов к таблице и каким методом» — на событие синка. */
  private requestCounts = new Map<string, number>();
  /** S2-3: база без 0047 — `sync_push` отвечает PGRST202, как PostgREST. */
  public withSyncPush = true;
  /** S2-3: `sync_op_keys` — `${uid}:${op_id}` → rev. */
  private opKeys = new Map<string, number | null>();

  constructor(opts: { withRev?: boolean; maxRows?: number } = {}) {
    this.withRev = opts.withRev ?? true;
    this.maxRows = opts.maxRows ?? 1000;
    this.reset();
  }

  /** Миграция 0045 применена/откатана посреди теста: строки получают/теряют
   *  `rev` так же, как при перезаписи таблицы и `drop column`. */
  public setWithRev(withRev: boolean): void {
    if (this.withRev === withRev) return;
    this.withRev = withRev;
    for (const rows of this.tables.values()) {
      for (const row of rows) {
        if (withRev && row.rev === undefined) row.rev = this.nextRev();
        if (!withRev) delete row.rev;
      }
    }
  }

  public setMaxRows(maxRows: number): void {
    this.maxRows = Math.max(0, Math.floor(maxRows));
  }

  public getRequestCount(table?: TableName, method?: 'select' | 'insert' | 'upsert' | 'update' | 'delete'): number {
    let total = 0;
    for (const [key, count] of this.requestCounts) {
      const [t, m] = key.split(':');
      if (table !== undefined && t !== table) continue;
      if (method !== undefined && m !== method) continue;
      total += count;
    }
    return total;
  }

  public resetRequestCounts(): void {
    this.requestCounts.clear();
  }

  private countRequest(table: TableName, method: 'select' | 'insert' | 'upsert' | 'update' | 'delete'): void {
    const key = `${table}:${method}`;
    this.requestCounts.set(key, (this.requestCounts.get(key) ?? 0) + 1);
  }

  private nextRev(): number {
    this.revSeq += 1;
    return this.revSeq;
  }

  private revUnavailable(table: TableName) {
    return {
      data: null as null,
      error: { message: `column ${table}.rev does not exist`, code: '42703' },
    };
  }

  private touchesRev(columns: Array<string | undefined | null>): boolean {
    return columns.some(column => column === 'rev');
  }

  public getTableNamesWithColumn(column: string): TableName[] {
    return (Object.keys(TABLE_COLUMNS) as TableName[]).filter(table =>
      TABLE_COLUMNS[table].includes(column)
    );
  }

  public reset(): void {
    this.tables.clear();
    this.sequences.clear();
    this.revSeq = 0;
    this.requestCounts.clear();
    this.opKeys.clear();
    const tableNames: TableName[] = [
      'documents',
      'versions',
      'drafts',
      'users',
      'ai_summaries',
      'ai_embeddings',
      'local_store_records',
    ];
    for (const t of tableNames) {
      this.tables.set(t, []);
    }
  }

  public getRows(table: TableName): PostgresRow[] {
    return this.tables.get(table) || [];
  }

  public setRows(table: TableName, rows: PostgresRow[]): void {
    this.tables.set(table, [...rows]);
  }

  public plaintextLeaks(markers: string[]): string[] {
    const leaks: string[] = [];
    if (markers.length === 0) return leaks;

    for (const [table, rows] of this.tables.entries()) {
      for (const row of rows) {
        for (const [col, val] of Object.entries(row)) {
          if (val === null || val === undefined) continue;
          const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
          for (const marker of markers) {
            if (marker && strVal.includes(marker)) {
              leaks.push(`${table}.${col}`);
              break;
            }
          }
        }
      }
    }
    return Array.from(new Set(leaks));
  }

  private nextId(table: string): string {
    const next = (this.sequences.get(table) || 0) + 1;
    this.sequences.set(table, next);
    return `${table}_${next}`;
  }

  // Prod: documents.updated_at defaults to now() and the tr_documents_updated_at
  // trigger (0028) overwrites it on every UPDATE. Without it here, a second
  // device's edit never looked newer to the first — the harness hid real sync.
  // Monotonic so two writes in one millisecond still order.
  private lastStamp = 0;
  public serverNow: () => number = () => Date.now();
  private stamp(): string {
    this.lastStamp = Math.max(this.serverNow(), this.lastStamp + 1);
    return new Date(this.lastStamp).toISOString();
  }

  /**
   * SF2-4: триггер 0037 для `local_store_records` — серверная метка ряда на
   * ЛЮБОМ insert/update, и клиент её не задаёт. Без неё на стенде не живут ни
   * CAS скалярной выгрузки, ни инкрементальный забор ИИ-данных: оба решаются
   * отметкой сервера. Для `documents` — прежний `updated_at` (0028).
   */
  private applyServerStamp(table: TableName, row: PostgresRow): void {
    if (table !== 'local_store_records') return;
    const s = this.stamp();
    row.stamped_at = s;
    row.updated_at = s;
  }

  public executeInsert(
    table: TableName,
    payload: PostgresRow | PostgresRow[]
  ): { data: PostgresRow[] | null; error: { message: string; code: string } | null } {
    this.countRequest(table, 'insert');
    const items = Array.isArray(payload) ? payload : [payload];
    if (!this.withRev && items.some(item => Object.prototype.hasOwnProperty.call(item, 'rev'))) {
      return this.revUnavailable(table);
    }
    const current = this.tables.get(table) || [];
    const inserted: PostgresRow[] = [];

    for (const item of items) {
      const row = { ...item };
      if (!row.id) row.id = this.nextId(table);
      if (!row.created_at) row.created_at = new Date().toISOString();
      if (table === 'documents' && !row.updated_at) row.updated_at = this.stamp();
      // S1-3: номер всегда серверный, присланное клиентом не доживает.
      if (this.withRev) row.rev = this.nextRev();
      this.applyServerStamp(table, row);

      // Уникальный кортеж (R4-029): enforced на insert так же, как на upsert.
      const tupleFn = UNIQUE_TUPLES[table];
      if (tupleFn) {
        const tuple = tupleFn(row);
        const conflict = current.find(r => tupleFn(r) === tuple);
        if (conflict) return duplicateError(table);
      }

      current.push(row);
      inserted.push(row);
    }

    this.tables.set(table, current);
    return { data: inserted, error: null };
  }

  public executeUpsert(
    table: TableName,
    payload: PostgresRow | PostgresRow[],
    onConflict?: string
  ): { data: PostgresRow[] | null; error: { message: string; code: string } | null } {
    this.countRequest(table, 'upsert');
    const items = Array.isArray(payload) ? payload : [payload];
    if (!this.withRev && items.some(item => Object.prototype.hasOwnProperty.call(item, 'rev'))) {
      return this.revUnavailable(table);
    }
    const current = this.tables.get(table) || [];
    const upserted: PostgresRow[] = [];

    for (const item of items) {
      const row = { ...item };
      const payloadHadId = Boolean(row.id);
      const payloadHadCreatedAt = Boolean(row.created_at);
      if (!row.id) row.id = this.nextId(table);
      if (!row.created_at) row.created_at = new Date().toISOString();

      // Without onConflict, PostgREST targets the primary key, not another unique index (0001_schema.sql:37,60,82).
      // С явным onConflict PostgREST целится в указанные колонки (ON CONFLICT (cols) DO UPDATE).
      const tupleFn = UNIQUE_TUPLES[table];
      const identityPrimaryKey = table === 'documents' || table === 'versions';
      const conflictCols = onConflict?.split(',').map(c => c.trim()).filter(Boolean);
      const matchIndex = conflictCols && conflictCols.length > 0
        ? current.findIndex(r => conflictCols.every(c => r[c] === row[c]))
        : identityPrimaryKey
          ? current.findIndex(r => r.id === row.id)
          : tupleFn ? current.findIndex(r => tupleFn(r) === tupleFn(row)) : -1;
      if (tupleFn && current.some((r, index) => index !== matchIndex && tupleFn(r) === tupleFn(row))) {
        return duplicateError(table);
      }

      if (matchIndex >= 0 && isTombstone(table, current[matchIndex]!)) {
        // 0047: `on conflict do update` идёт только по видимым строкам.
        return { data: null, error: { message: `new row violates row-level security policy for table "${table}"`, code: '42501' } };
      }
      if (matchIndex >= 0) {
        const merged: PostgresRow = { ...current[matchIndex], ...row, ...(table === 'documents' ? { updated_at: this.stamp() } : {}) };
        // PostgREST обновляет только колонки payload: сгенерированные id/created_at
        // не вправе затирать существующие, если вызывающий их не прислал.
        if (!payloadHadId) merged.id = current[matchIndex]!.id;
        if (!payloadHadCreatedAt) merged.created_at = current[matchIndex]!.created_at;
        if (this.withRev) merged.rev = this.nextRev();
        this.applyServerStamp(table, merged);
        current[matchIndex] = merged;
        upserted.push(current[matchIndex]!);
      } else {
        if (table === 'documents' && !row.updated_at) row.updated_at = this.stamp();
        if (this.withRev) row.rev = this.nextRev();
        this.applyServerStamp(table, row);
        current.push(row);
        upserted.push(row);
      }
    }

    this.tables.set(table, current);
    return { data: upserted, error: null };
  }

  public executeUpdate(
    table: TableName,
    payload: PostgresRow,
    filters: QueryFilter[]
  ): { data: PostgresRow[] | null; error: { message: string; code: string } | null } {
    this.countRequest(table, 'update');
    if (!this.withRev && Object.prototype.hasOwnProperty.call(payload, 'rev')) {
      return this.revUnavailable(table);
    }
    const current = this.tables.get(table) || [];
    const updated: PostgresRow[] = [];

    for (let i = 0; i < current.length; i++) {
      if (!isTombstone(table, current[i]!) && this.matchesFilters(current[i]!, filters)) {
        const merged: PostgresRow = { ...current[i], ...payload, ...(table === 'documents' ? { updated_at: this.stamp() } : {}) };
        if (this.withRev) merged.rev = this.nextRev();
        this.applyServerStamp(table, merged);
        current[i] = merged;
        updated.push(current[i]!);
      }
    }

    this.tables.set(table, current);
    return { data: updated, error: null };
  }

  public executeDelete(
    table: TableName,
    filters: QueryFilter[]
  ): { data: PostgresRow[] | null; error: { message: string; code: string } | null } {
    this.countRequest(table, 'delete');
    const current = this.tables.get(table) || [];
    const remaining: PostgresRow[] = [];
    const deleted: PostgresRow[] = [];

    for (const row of current) {
      if (!isTombstone(table, row) && this.matchesFilters(row, filters)) {
        deleted.push(row);
      } else {
        remaining.push(row);
      }
    }

    this.tables.set(table, remaining);
    return { data: deleted, error: null };
  }

  public executeSelect(
    table: TableName,
    filters: QueryFilter[],
    orders: QueryOrder[],
    limitCount?: number,
    rangeOffset?: { from: number; to: number },
    selectedColumns?: readonly string[] | null,
  ): { data: PostgresRow[] | null; error: { message: string; code: string } | null } {
    this.countRequest(table, 'select');
    // S1-3: база без 0045 отвечает так же, как PostgREST: колонки нет.
    if (!this.withRev && this.touchesRev([
      ...filters.map(f => f.column),
      ...orders.map(o => o.column),
      ...(selectedColumns ?? []),
    ])) {
      return this.revUnavailable(table);
    }

    let rows = (this.tables.get(table) || []).filter(r => !isTombstone(table, r) && this.matchesFilters(r, filters));

    if (orders.length > 0) {
      rows = [...rows].sort((a, b) => {
        for (const ord of orders) {
          const va = a[ord.column];
          const vb = b[ord.column];
          if (va !== vb) {
            if (va === undefined || va === null) return ord.ascending ? -1 : 1;
            if (vb === undefined || vb === null) return ord.ascending ? 1 : -1;
            if (typeof va === 'number' && typeof vb === 'number') {
              return ord.ascending ? va - vb : vb - va;
            }
            const sa = String(va);
            const sb = String(vb);
            return ord.ascending ? sa.localeCompare(sb) : sb.localeCompare(sa);
          }
        }
        return 0;
      });
    }

    // S1-3: потолок PostgREST (`PGRST_DB_MAX_ROWS`) режет и limit, и range.
    if (rangeOffset) {
      const to = Math.min(rangeOffset.to + 1, rangeOffset.from + this.maxRows);
      rows = rows.slice(rangeOffset.from, to);
    } else if (limitCount !== undefined) {
      rows = rows.slice(0, Math.min(limitCount, this.maxRows));
    } else {
      // PostgREST режет ответ потолком и без явного limit/range — иначе харнес
      // разрешал бы чтение, которое прод молча обрежет.
      rows = rows.slice(0, this.maxRows);
    }

    return { data: rows.map(r => ({ ...r })), error: null };
  }

  /**
   * S2-3: `sync_push` (0047) с той же семантикой, что SQL-функция: пачка — одна
   * транзакция (здесь — синхронный проход), ответ по элементам в том же порядке.
   * `user_id` из элемента не читается.
   */
  /**
   * Ревью SYNC2: настоящая функция — одна транзакция, плохой элемент откатывает
   * весь пакет. Стенд раньше применял элементы до плохого и возвращал ошибку —
   * тест мог пройти там, где прод отказал бы целиком.
   */
  public executeSyncPush(
    uid: string | null,
    items: SyncPushItem[],
  ): { data: SyncPushResult[] | null; error: { message: string; code: string } | null } {
    const lsrBefore = structuredClone(this.tables.get('local_store_records')!);
    const docsBefore = structuredClone(this.tables.get('documents')!);
    const keysBefore = new Map(this.opKeys);
    const res = this.executeSyncPushItems(uid, items);
    if (res.error) {
      const lsr = this.tables.get('local_store_records')!;
      lsr.splice(0, lsr.length, ...lsrBefore);
      const docs = this.tables.get('documents')!;
      docs.splice(0, docs.length, ...docsBefore);
      this.opKeys = keysBefore;
    }
    return res;
  }

  private executeSyncPushItems(
    uid: string | null,
    items: SyncPushItem[],
  ): { data: SyncPushResult[] | null; error: { message: string; code: string } | null } {
    if (!this.withSyncPush) {
      return { data: null, error: { message: 'Could not find the function public.sync_push(items) in the schema cache', code: 'PGRST202' } };
    }
    if (!uid) return { data: null, error: { message: 'sync_push: no user', code: '42501' } };
    if (!Array.isArray(items) || items.length > 100) {
      return { data: null, error: { message: 'sync_push: expected an array of at most 100 items', code: '22023' } };
    }
    const lsr = this.tables.get('local_store_records')!;
    const docs = this.tables.get('documents')!;
    const ms = (iso: unknown) => Date.parse(String(iso));
    const rowOf = (r: PostgresRow) => ({
      rev: r.rev as number, deleted: r.deleted === true, payload: r.payload, checksum: r.checksum ?? null, stamped_at: ms(r.stamped_at),
    });
    const write = (r: PostgresRow, patch: PostgresRow): SyncPushResult => {
      Object.assign(r, patch);
      r.rev = this.nextRev();
      this.applyServerStamp('local_store_records', r);
      return { status: 'ok', rev: r.rev as number, stamped_at: ms(r.stamped_at), payload_updated_at: (r.payload as Record<string, unknown> | null)?.updatedAt ?? null };
    };
    const out: SyncPushResult[] = [];
    for (const it of items) {
      const table = it.table;
      const op = it.op;
      const base = it.base_rev === null || it.base_rev === undefined ? null : Number(it.base_rev);
      if (table === 'local_store_records' && (op === 'put' || op === 'recreate' || op === 'delete')) {
        const store = String(it.store ?? '');
        const key = String(it.key ?? '');
        if (!store || !key) return { data: null, error: { message: 'sync_push: store/key required', code: '22023' } };
        const cur = lsr.find(r => r.user_id === uid && r.store === store && r.key === key);
        const conflict = (): SyncPushResult => ({ status: 'conflict', row: cur ? rowOf(cur) : null });
        if (op === 'put' && base === null) {
          if (cur) { out.push(conflict()); continue; }
          const row: PostgresRow = { id: this.nextId('local_store_records'), user_id: uid, store, key, payload: it.payload, checksum: it.checksum ?? null, deleted: false, created_at: new Date().toISOString() };
          lsr.push(row);
          out.push(write(row, {}));
        } else if (op === 'put') {
          out.push(cur && cur.rev === base && cur.deleted !== true ? write(cur, { payload: it.payload, checksum: it.checksum ?? null }) : conflict());
        } else if (op === 'recreate') {
          out.push(cur && cur.rev === base && cur.deleted === true ? write(cur, { payload: it.payload, checksum: it.checksum ?? null, deleted: false }) : conflict());
        } else if (!cur) {
          out.push({ status: 'ok', rev: null });
        } else if (cur.deleted === true) {
          out.push({ status: 'ok', rev: cur.rev as number });
        } else {
          out.push(cur.rev === base ? { ...write(cur, { deleted: true, payload: {}, checksum: null }), payload_updated_at: undefined } : conflict());
        }
      } else if (table === 'documents' && op === 'delta') {
        const uuid = String(it.uuid ?? '');
        const opId = String(it.op_id ?? '');
        if (!uuid || !opId) return { data: null, error: { message: 'sync_push: op_id/uuid required', code: '22023' } };
        const doc = docs.find(d => d.uuid === uuid && d.user_id === uid);
        if (!doc) { out.push({ status: 'missing' }); continue; }
        if (doc.deleted_at !== null && doc.deleted_at !== undefined) { out.push({ status: 'gone' }); continue; }
        const k = `${uid}:${opId}`;
        if (this.opKeys.has(k)) { out.push({ status: 'duplicate', rev: this.opKeys.get(k) ?? null }); continue; }
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        // 0042: накопительные счётчики назад не идут.
        doc.sessions_count = Math.max(num(doc.sessions_count), num(doc.sessions_count) + num(it.sessions));
        doc.total_duration = Math.max(num(doc.total_duration), num(doc.total_duration) + num(it.duration));
        doc.total_words = Math.max(num(doc.total_words), num(it.words));
        doc.updated_at = this.stamp();
        if (this.withRev) doc.rev = this.nextRev();
        this.opKeys.set(k, (doc.rev as number | undefined) ?? null);
        out.push({ status: 'ok', rev: (doc.rev as number | undefined) ?? null });
      } else {
        return { data: null, error: { message: `sync_push: unknown item ${String(table)}/${String(op)}`, code: '22023' } };
      }
    }
    return { data: out, error: null };
  }

  /**
   * SF2-4: порядковое сравнение для фильтров `gt/gte/lt/lte`. Числа — как раньше.
   * Серверные метки (`stamped_at`, `updated_at`) прод отдаёт строками ISO-8601, а
   * провайдер ставит условие тоже ISO-строкой: без этой ветки CAS скаляра и
   * инкрементальный забор ИИ-данных на стенде не срабатывали бы вовсе.
   * Строка-курсор (например `document_id` у эмбеддингов) под ISO не попадает и
   * остаётся несравнимой — как было.
   */
  private compareRange(val: unknown, filterValue: unknown): number | null {
    if (typeof val === 'number' && typeof filterValue === 'number') {
      return val === filterValue ? 0 : val < filterValue ? -1 : 1;
    }
    if (typeof val === 'string' && typeof filterValue === 'string' && ISO_STAMP.test(val) && ISO_STAMP.test(filterValue)) {
      const a = Date.parse(val);
      const b = Date.parse(filterValue);
      if (Number.isFinite(a) && Number.isFinite(b)) return a === b ? 0 : a < b ? -1 : 1;
    }
    return null;
  }

  public matchesFilters(row: PostgresRow, filters: QueryFilter[]): boolean {
    for (const f of filters) {
      const val = row[f.column];
      switch (f.type) {
        case 'eq':
          if (val !== f.value) return false;
          break;
        case 'is':
          if (f.value === null) {
            if (val !== null && val !== undefined) return false;
          } else {
            if (val !== f.value) return false;
          }
          break;
        case 'in':
          if (!Array.isArray(f.value) || !f.value.includes(val)) return false;
          break;
        case 'not':
          if (f.operator === 'is') {
            if (f.value === null && (val === null || val === undefined)) return false;
          } else if (val === f.value) {
            return false;
          }
          break;
        case 'gt':
          { const c = this.compareRange(val, f.value); if (c === null || c <= 0) return false; }
          break;
        case 'gte':
          { const c = this.compareRange(val, f.value); if (c === null || c < 0) return false; }
          break;
        case 'lt':
          { const c = this.compareRange(val, f.value); if (c === null || c >= 0) return false; }
          break;
        case 'lte':
          { const c = this.compareRange(val, f.value); if (c === null || c > 0) return false; }
          break;
        case 'like': {
          const str = String(val ?? '');
          const pat = String(f.value).replace(/%/g, '.*');
          if (!new RegExp(`^${pat}$`).test(str)) return false;
          break;
        }
      }
    }
    return true;
  }
}
