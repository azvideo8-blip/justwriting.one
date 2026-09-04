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

export class InMemoryPostgres {
  public tables: Map<TableName, PostgresRow[]> = new Map();
  private sequences: Map<string, number> = new Map();

  constructor() {
    this.reset();
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
    if (!markers || markers.length === 0) return leaks;

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

      // Check unique constraints:
      // 1. documents: unique (uuid, user_id) or uuid
      if (table === 'documents' && row.uuid) {
        const conflict = current.find(r => r.uuid === row.uuid);
        if (conflict) {
          return {
            data: null,
            error: {
              message: 'duplicate key value violates unique constraint "documents_uuid_key"',
              code: '23505',
            },
          };
        }
      }

      // 2. versions: unique (document_uuid, version, user_id)
      if (table === 'versions' && row.document_uuid && row.version !== undefined) {
        const conflict = current.find(
          r => r.document_uuid === row.document_uuid && r.version === row.version
        );
        if (conflict) {
          return {
            data: null,
            error: {
              message: 'duplicate key value violates unique constraint "versions_doc_ver_key"',
              code: '23505',
            },
          };
        }
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

      let matchIndex = -1;
      if (table === 'documents' && row.uuid) {
        matchIndex = current.findIndex(r => r.uuid === row.uuid);
      } else if (table === 'versions' && row.document_uuid && row.version !== undefined) {
        matchIndex = current.findIndex(
          r => r.document_uuid === row.document_uuid && r.version === row.version
        );
      } else if (table === 'drafts' && row.user_id) {
        matchIndex = current.findIndex(r => r.user_id === row.user_id);
      } else if (table === 'users' && row.uid) {
        matchIndex = current.findIndex(r => r.uid === row.uid);
      } else if (table === 'ai_summaries' && row.document_id) {
        matchIndex = current.findIndex(r => r.document_id === row.document_id);
      } else if (table === 'ai_embeddings' && row.document_id) {
        matchIndex = current.findIndex(r => r.document_id === row.document_id);
      } else if (table === 'local_store_records' && (row.store || row.store_name) && (row.key || row.record_key)) {
        const rowStore = row.store || row.store_name;
        const rowKey = row.key || row.record_key;
        matchIndex = current.findIndex(
          r => (r.store === rowStore || r.store_name === rowStore) &&
               (r.key === rowKey || r.record_key === rowKey) &&
               r.user_id === row.user_id
        );
      }

      if (matchIndex >= 0) {
        current[matchIndex] = { ...current[matchIndex], ...row };
        upserted.push(current[matchIndex]!);
      } else {
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
        current[i] = { ...current[i], ...payload };
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
