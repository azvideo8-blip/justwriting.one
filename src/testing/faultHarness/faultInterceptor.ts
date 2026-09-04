/**
 * Fault Interceptor
 *
 * Coordinates fault injection into Supabase, IndexedDB, WebCrypto, and Timers.
 */

import { InMemoryPostgres, TableName, QueryFilter, QueryOrder } from './inMemoryPostgres';
import { FaultType, StepName } from './faultTypes';
import * as supabaseClientModule from '../../core/supabase/client';
import * as callAiModule from '../../core/ai/callAi';
import * as authModule from '../../core/auth';
import * as aiConsentModule from '../../core/ai/aiConsent';
import { vi } from 'vitest';
import { clearSessionKey } from '../../core/crypto/encrypt';

export interface ArmedFault {
  fault: FaultType;
  step: StepName;
  table?: TableName | undefined;
  triggerCount?: number | undefined;
  currentCount?: number | undefined;
}

export class FaultInterceptor {
  public postgres: InMemoryPostgres;
  private armedFault: ArmedFault | null = null;
  public currentStep: StepName = 'initial_write';
  public aiCallsIntercepted: { endpoint: string; payload: unknown; consentPresent: boolean }[] = [];
  public clockOffsetMs: number = 0;
  public onStep?: ((step: StepName) => void | Promise<void>) | undefined;
  private originalDateNow = Date.now;

  constructor(postgres?: InMemoryPostgres) {
    this.postgres = postgres || new InMemoryPostgres();
  }

  public armFault(fault: FaultType, step: StepName, table?: TableName): void {
    this.armedFault = {
      fault,
      step,
      table,
      triggerCount: 1,
      currentCount: 0,
    };
  }

  public clearArmedFault(): void {
    this.armedFault = null;
  }

  public setStep(step: StepName): void {
    this.currentStep = step;
    if (this.armedFault && this.armedFault.step === step) {
      if (this.armedFault.fault === 'vault_locked') {
        clearSessionKey();
      } else if (this.armedFault.fault === 'clock_backwards') {
        this.clockOffsetMs = -600_000; // Jump 10 minutes into the past
      }
    }
    if (this.onStep) {
      void this.onStep(step);
    }
  }

  public installMocks(): void {
    // 1. Mock getSupabase to route through InMemoryPostgres with fault injection
    vi.spyOn(supabaseClientModule, 'getSupabase').mockImplementation(() => {
      return this.createMockSupabaseClient() as never;
    });

    // 2. Mock Date.now for clock jump tests
    Date.now = () => {
      return this.originalDateNow() + this.clockOffsetMs;
    };

    // 3. Spy on callAi to detect unsolicited AI calls
    this.aiCallsIntercepted = [];
    vi.spyOn(callAiModule, 'callAi').mockImplementation(async (name: string, data: unknown) => {
      let consent = false;
      try {
        const u = authModule.getCurrentUser();
        if (u) {
          consent = aiConsentModule.getAiConsent(u.uid);
        }
      } catch {
        // ignore
      }
      this.aiCallsIntercepted.push({
        endpoint: name,
        payload: data,
        consentPresent: consent,
      });
      return { success: true } as never;
    });
  }

  public uninstallMocks(): void {
    vi.restoreAllMocks();
    Date.now = this.originalDateNow;
    this.clockOffsetMs = 0;
    this.aiCallsIntercepted = [];
    this.onStep = undefined;
  }

  private shouldTriggerFault(table?: TableName): FaultType | null {
    if (!this.armedFault) return null;
    if (this.armedFault.step !== this.currentStep) return null;
    if (this.armedFault.table && table && this.armedFault.table !== table) return null;

    this.armedFault.currentCount = (this.armedFault.currentCount || 0) + 1;
    return this.armedFault.fault;
  }

  public createMockSupabaseClient() {
    return {
      from: (table: TableName) => this.createQueryBuilder(table),
      rpc: (fnName: string, _args: unknown) => {
        const fault = this.shouldTriggerFault();
        if (fault === 'postgres_500') {
          return Promise.resolve({ data: null, error: { message: `RPC ${fnName} failed`, code: '500' } });
        }
        if (fault === 'network_pre') {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return Promise.resolve({ data: null, error: null });
      },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => {},
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        refreshSession: () => Promise.resolve({ data: { session: null }, error: null }),
        signInWithPassword: () => Promise.resolve({ data: { user: null }, error: null }),
        signUp: () => Promise.resolve({ data: { user: null }, error: null }),
      },
    };
  }

  private createQueryBuilder(table: TableName) {
    const filters: QueryFilter[] = [];
    const orders: QueryOrder[] = [];
    let limitCount: number | undefined;
    let rangeOffset: { from: number; to: number } | undefined;
    let isSingle = false;
    let isMaybeSingle = false;

    type BuilderOp = 'select' | 'insert' | 'upsert' | 'update' | 'delete';
    let op: BuilderOp = 'select';
    let opPayload: unknown;

    const builder: Record<string, unknown> = {
      select: () => {
        op = 'select';
        return builder;
      },
      insert: (payload: unknown) => {
        op = 'insert';
        opPayload = payload;
        return builder;
      },
      upsert: (payload: unknown) => {
        op = 'upsert';
        opPayload = payload;
        return builder;
      },
      update: (payload: unknown) => {
        op = 'update';
        opPayload = payload;
        return builder;
      },
      delete: () => {
        op = 'delete';
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters.push({ type: 'eq', column: col, value: val });
        return builder;
      },
      is: (col: string, val: unknown) => {
        filters.push({ type: 'is', column: col, value: val });
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push({ type: 'in', column: col, value: vals });
        return builder;
      },
      not: (col: string, operator: string, val: unknown) => {
        filters.push({ type: 'not', column: col, value: val, operator });
        return builder;
      },
      gt: (col: string, val: unknown) => {
        filters.push({ type: 'gt', column: col, value: val });
        return builder;
      },
      gte: (col: string, val: unknown) => {
        filters.push({ type: 'gte', column: col, value: val });
        return builder;
      },
      lt: (col: string, val: unknown) => {
        filters.push({ type: 'lt', column: col, value: val });
        return builder;
      },
      lte: (col: string, val: unknown) => {
        filters.push({ type: 'lte', column: col, value: val });
        return builder;
      },
      like: (col: string, val: string) => {
        filters.push({ type: 'like', column: col, value: val });
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orders.push({ column: col, ascending: opts?.ascending ?? true });
        return builder;
      },
      limit: (n: number) => {
        limitCount = n;
        return builder;
      },
      range: (from: number, to: number) => {
        rangeOffset = { from, to };
        return builder;
      },
      maybeSingle: () => {
        isMaybeSingle = true;
        return builder;
      },
      single: () => {
        isSingle = true;
        return builder;
      },
      then: (resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) => {
        const execute = async () => {
          const fault = this.shouldTriggerFault(table);

          // 1. Fault before execution
          if (fault === 'network_pre') {
            throw new TypeError('Failed to fetch (offline before request)');
          }
          if (fault === 'network_mid') {
            throw new Error('Connection aborted by peer (mid-request)');
          }
          if (fault === 'abort') {
            throw new DOMException('The user aborted a request.', 'AbortError');
          }
          if (fault === 'postgres_500') {
            return { data: null, error: { message: 'Internal Server Error', code: '500' } };
          }
          if (fault === 'postgres_409') {
            return {
              data: null,
              error: {
                message: 'duplicate key value violates unique constraint "documents_uuid_key"',
                code: '23505',
              },
            };
          }
          if (fault === 'postgres_429') {
            return { data: null, error: { message: 'Too many requests', code: '429' } };
          }

          // 2. Normal execution against InMemoryPostgres
          let result: { data: unknown; error: unknown } = { data: null, error: null };
          switch (op) {
            case 'insert':
              result = this.postgres.executeInsert(table, opPayload as Record<string, unknown>);
              break;
            case 'upsert':
              result = this.postgres.executeUpsert(table, opPayload as Record<string, unknown>);
              break;
            case 'update':
              result = this.postgres.executeUpdate(table, opPayload as Record<string, unknown>, filters);
              break;
            case 'delete':
              result = this.postgres.executeDelete(table, filters);
              break;
            case 'select': {
              const res = this.postgres.executeSelect(table, filters, orders, limitCount, rangeOffset);
              let data: Record<string, unknown> | Record<string, unknown>[] | null = res.data;
              if (isSingle) {
                data = (res.data && res.data.length > 0) ? res.data[0]! : null;
              } else if (isMaybeSingle) {
                data = (res.data && res.data.length > 0) ? res.data[0]! : null;
              }
              result = { data, error: res.error };
              break;
            }
          }

          // 3. Phantom Write (network_post):
          // Write succeeded in Postgres, BUT network drops before client gets ACK!
          if (fault === 'network_post') {
            throw new TypeError('Failed to fetch (write committed, ACK dropped by network)');
          }

          return result;
        };

        return execute().then(resolve, reject);
      },
    };

    return builder;
  }
}
