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
  documents: ['id', 'uuid', 'user_id', 'title', 'content', 'created_at', 'updated_at', 'deleted_at'],
  versions: ['id', 'document_uuid', 'user_id', 'version', 'content', 'created_at'],
  drafts: ['id', 'user_id', 'content', 'created_at', 'updated_at'],
  users: ['id', 'uid', 'email', 'encryption_meta', 'created_at'],
  ai_summaries: ['id', 'document_id', 'user_id', 'summary', 'created_at'],
  ai_embeddings: ['id', 'document_id', 'user_id', 'dim', 'created_at'],
  local_store_records: ['id', 'user_id', 'store', 'key', 'payload', 'created_at', 'updated_at'],
};

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

  constructor() {
    this.reset();
  }

  public getTableNamesWithColumn(column: string): TableName[] {
    return (Object.keys(TABLE_COLUMNS) as TableName[]).filter(table =>
      TABLE_COLUMNS[table].includes(column)
    );
  }

  public reset(): void {
    this.tables.clear();
    this.sequences.clear();
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
  private stamp(): string {
    this.lastStamp = Math.max(Date.now(), this.lastStamp + 1);
    return new Date(this.lastStamp).toISOString();
  }

  public executeInsert(
    table: TableName,
    payload: PostgresRow | PostgresRow[]
  ): { data: PostgresRow[] | null; error: { message: string; code: string } | null } {
    const current = this.tables.get(table) || [];
    const items = Array.isArray(payload) ? payload : [payload];
    const inserted: PostgresRow[] = [];

    for (const item of items) {
      const row = { ...item };
      if (!row.id) row.id = this.nextId(table);
      if (!row.created_at) row.created_at = new Date().toISOString();
      if (table === 'documents' && !row.updated_at) row.updated_at = this.stamp();

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
    payload: PostgresRow | PostgresRow[]
  ): { data: PostgresRow[] | null; error: { message: string; code: string } | null } {
    const current = this.tables.get(table) || [];
    const items = Array.isArray(payload) ? payload : [payload];
    const upserted: PostgresRow[] = [];

    for (const item of items) {
      const row = { ...item };
      if (!row.id) row.id = this.nextId(table);
      if (!row.created_at) row.created_at = new Date().toISOString();

      // Сопоставление по тому же уникальному кортежу, что стережёт insert (R4-029).
      const tupleFn = UNIQUE_TUPLES[table];
      let matchIndex = -1;
      if (tupleFn) {
        const tuple = tupleFn(row);
        matchIndex = current.findIndex(r => tupleFn(r) === tuple);
      }

      if (matchIndex >= 0) {
        current[matchIndex] = { ...current[matchIndex], ...row, ...(table === 'documents' ? { updated_at: this.stamp() } : {}) };
        upserted.push(current[matchIndex]!);
      } else {
        if (table === 'documents' && !row.updated_at) row.updated_at = this.stamp();
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
    const current = this.tables.get(table) || [];
    const updated: PostgresRow[] = [];

    for (let i = 0; i < current.length; i++) {
      if (this.matchesFilters(current[i]!, filters)) {
        current[i] = { ...current[i], ...payload, ...(table === 'documents' ? { updated_at: this.stamp() } : {}) };
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
    const current = this.tables.get(table) || [];
    const remaining: PostgresRow[] = [];
    const deleted: PostgresRow[] = [];

    for (const row of current) {
      if (this.matchesFilters(row, filters)) {
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
    rangeOffset?: { from: number; to: number }
  ): { data: PostgresRow[] | null; error: { message: string; code: string } | null } {
    let rows = (this.tables.get(table) || []).filter(r => this.matchesFilters(r, filters));

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

    if (rangeOffset) {
      rows = rows.slice(rangeOffset.from, rangeOffset.to + 1);
    } else if (limitCount !== undefined) {
      rows = rows.slice(0, limitCount);
    }

    return { data: rows.map(r => ({ ...r })), error: null };
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
          if (typeof val !== 'number' || val <= (f.value as number)) return false;
          break;
        case 'gte':
          if (typeof val !== 'number' || val < (f.value as number)) return false;
          break;
        case 'lt':
          if (typeof val !== 'number' || val >= (f.value as number)) return false;
          break;
        case 'lte':
          if (typeof val !== 'number' || val > (f.value as number)) return false;
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
