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
import { clearSessionKey, encryptContent, generateDataKey, getSessionKey } from '../../core/crypto/encrypt';
import { getLocalDb } from '../../core/storage/localDb';
import { IDBObjectStore } from 'fake-indexeddb';

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
  public capturedPayloads: Array<{ table: TableName; op: string; payload: unknown }> = [];
  public clockOffsetMs: number = 0;
  public onStep?: ((step: StepName) => void | Promise<void>) | undefined;
  // Вызывается после каждого запроса к базе, до того как ответ вернулся в код:
  // запрос выполнен с сессией прежнего человека, а ответ приходит уже к новому.
  public onRequest?: ((table: TableName) => void | Promise<void>) | undefined;
  // Как RLS на проде: запрос видит и пишет только строки того, чья сейчас сессия.
  // R4-030: включён по умолчанию — ячейки матрицы ходят в базу через клиента,
  // как прод, и не видят чужие строки. Явно выключить может только тест,
  // который сам seeding'ит чужие строки (accountSwitch).
  public rls = true;
  private originalDateNow = Date.now;
  public faultFiredCount: number = 0;
  private clockBackwardsFired: boolean = false;
  private originalIdbGet: typeof IDBObjectStore.prototype.get | null = null;

  constructor(postgres?: InMemoryPostgres) {
    this.postgres = postgres || new InMemoryPostgres();
  }

  public recordFaultFired(): void {
    this.faultFiredCount++;
  }

  public getFaultFiredCount(): number {
    return this.faultFiredCount;
  }

  public resetFaultFired(): void {
    this.faultFiredCount = 0;
    this.clockBackwardsFired = false;
  }

  public payloadLeaks(markers: string[]): string[] {
    const leaks: string[] = [];
    for (const item of this.capturedPayloads) {
      const str = JSON.stringify(item.payload);
      for (const m of markers) {
        if (str.includes(m)) {
          leaks.push(`${item.table}:${item.op}`);
        }
      }
    }
    return leaks;
  }

  public async corruptSingleCloudVersion(targetVersion: number = 2): Promise<void> {
    const foreignKey = await generateDataKey();
    const foreignCiphertext = await encryptContent('CORRUPTED_FOREIGN_CIPHERTEXT', foreignKey);
    const rows = this.postgres.getRows('versions');
    const targetRow = rows.find(r => r.version === targetVersion) || rows[0];
    if (targetRow) {
      targetRow.content = foreignCiphertext;
      targetRow._encrypted = true;
    }
  }

  private originalIdbPut: typeof IDBObjectStore.prototype.put | null = null;
  private originalIdbAdd: typeof IDBObjectStore.prototype.add | null = null;

  public applyIdbQuotaPatch(): void {
    if (this.originalIdbPut) return;
    this.originalIdbPut = IDBObjectStore.prototype.put;
    this.originalIdbAdd = IDBObjectStore.prototype.add;
    const record = () => this.recordFaultFired();

    IDBObjectStore.prototype.put = function (_value?: unknown, _key?: unknown) {
      record();
      const quotaErr = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      const tx = this.transaction as unknown as { error?: DOMException; _execRequestAsync: (arg: unknown) => unknown };
      tx.error = quotaErr;
      return tx._execRequestAsync({
        operation: () => {
          throw quotaErr;
        },
        source: this,
      }) as unknown as IDBRequest<IDBValidKey>;
    };

    IDBObjectStore.prototype.add = function (_value?: unknown, _key?: unknown) {
      record();
      const quotaErr = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      const tx = this.transaction as unknown as { error?: DOMException; _execRequestAsync: (arg: unknown) => unknown };
      tx.error = quotaErr;
      return tx._execRequestAsync({
        operation: () => {
          throw quotaErr;
        },
        source: this,
      }) as unknown as IDBRequest<IDBValidKey>;
    };
  }

  public restoreIdbQuotaPatch(): void {
    if (this.originalIdbPut) {
      IDBObjectStore.prototype.put = this.originalIdbPut;
      this.originalIdbPut = null;
    }
    if (this.originalIdbAdd) {
      IDBObjectStore.prototype.add = this.originalIdbAdd;
      this.originalIdbAdd = null;
    }
  }

  private originalIdbAutoclosePut: typeof IDBObjectStore.prototype.put | null = null;
  private originalIdbAutocloseAdd: typeof IDBObjectStore.prototype.add | null = null;

  public applyIdbAutoclosePatch(): void {
    if (this.originalIdbAutoclosePut) return;
    this.originalIdbAutoclosePut = IDBObjectStore.prototype.put;
    this.originalIdbAutocloseAdd = IDBObjectStore.prototype.add;
    const record = () => this.recordFaultFired();

    IDBObjectStore.prototype.put = function (_value?: unknown, _key?: unknown) {
      record();
      const inactiveErr = new DOMException('The transaction is not active.', 'TransactionInactiveError');
      const tx = this.transaction as unknown as { error?: DOMException; _execRequestAsync: (arg: unknown) => unknown };
      tx.error = inactiveErr;
      return tx._execRequestAsync({
        operation: () => {
          throw inactiveErr;
        },
        source: this,
      }) as unknown as IDBRequest<IDBValidKey>;
    };

    IDBObjectStore.prototype.add = function (_value?: unknown, _key?: unknown) {
      record();
      const inactiveErr = new DOMException('The transaction is not active.', 'TransactionInactiveError');
      const tx = this.transaction as unknown as { error?: DOMException; _execRequestAsync: (arg: unknown) => unknown };
      tx.error = inactiveErr;
      return tx._execRequestAsync({
        operation: () => {
          throw inactiveErr;
        },
        source: this,
      }) as unknown as IDBRequest<IDBValidKey>;
    };
  }

  public restoreIdbAutoclosePatch(): void {
    if (this.originalIdbAutoclosePut) {
      IDBObjectStore.prototype.put = this.originalIdbAutoclosePut;
      this.originalIdbAutoclosePut = null;
    }
    if (this.originalIdbAutocloseAdd) {
      IDBObjectStore.prototype.add = this.originalIdbAutocloseAdd;
      this.originalIdbAutocloseAdd = null;
    }
  }

  public async applyConcurrentTabLock(documentId: string): Promise<void> {
    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: `lock_cloud_${documentId}`,
      documentId,
      type: 'document' as const,
      createdAt: Date.now(),
      ownerToken: 'concurrent_tab_owner_' + Math.random().toString(36).slice(2),
    });
  }

  public armFault(fault: FaultType, step: StepName, table?: TableName): void {
    this.armedFault = {
      fault,
      step,
      table,
      triggerCount: 1,
      currentCount: 0,
    };
    if (this.currentStep === step) {
      if (fault === 'vault_locked') {
        this.armVaultLock();
      } else if (fault === 'clock_backwards') {
        this.clockOffsetMs = -600_000;
      } else if (fault === 'decrypt_corrupt_single') {
        void this.corruptSingleCloudVersion();
      } else if (fault === 'idb_quota') {
        this.applyIdbQuotaPatch();
      } else if (fault === 'idb_tx_autoclose') {
        this.applyIdbAutoclosePatch();
      }
    }
  }

  // R4-031: пожар vault_locked считается, только когда сейф реально был
  // разлочен — был ключ, который сброс меняет. В ячейках без сейфа
  // clearSessionKey — no-op, и «сработавший» сбой был фикцией GT-2.
  private armVaultLock(): void {
    if (getSessionKey()) {
      clearSessionKey();
      this.recordFaultFired();
    }
  }

  public clearArmedFault(): void {
    this.armedFault = null;
    this.restoreIdbQuotaPatch();
    this.restoreIdbAutoclosePatch();
    this.clockOffsetMs = 0;
    this.clockBackwardsFired = false;
  }

  public setStep(step: StepName): void {
    this.currentStep = step;
    if (this.armedFault && this.armedFault.step === step) {
      if (this.armedFault.fault === 'vault_locked') {
        this.armVaultLock();
      } else if (this.armedFault.fault === 'clock_backwards') {
        this.clockOffsetMs = -600_000; // Jump 10 minutes into the past
      } else if (this.armedFault.fault === 'decrypt_corrupt_single') {
        void this.corruptSingleCloudVersion();
      } else if (this.armedFault.fault === 'idb_quota') {
        this.applyIdbQuotaPatch();
      } else if (this.armedFault.fault === 'idb_tx_autoclose') {
        this.applyIdbAutoclosePatch();
      }
    } else {
      if (this.originalIdbPut) {
        this.restoreIdbQuotaPatch();
      }
      if (this.originalIdbAutoclosePut) {
        this.restoreIdbAutoclosePatch();
      }
      if (this.armedFault?.fault !== 'clock_backwards') {
        this.clockOffsetMs = 0;
      }
    }
    if (this.onStep) {
      void this.onStep(step);
    }
  }

  private cleanups: (() => void)[] = [];

  private spy<T extends object, K extends keyof T>(obj: T, method: K, mock: unknown): void {
    const globalVi = (globalThis as unknown as { vi?: { spyOn: (o: unknown, m: string) => { mockImplementation: (fn: unknown) => void } } }).vi;
    if (globalVi) {
      globalVi.spyOn(obj, method as string).mockImplementation(mock as () => unknown);
    } else {
      const desc = Object.getOwnPropertyDescriptor(obj, method);
      Object.defineProperty(obj, method, {
        value: mock,
        configurable: true,
        writable: true,
      });
      this.cleanups.push(() => {
        if (desc) {
          Object.defineProperty(obj, method, desc);
        } else {
          delete (obj as Record<keyof T, unknown>)[method];
        }
      });
    }
  }

  public installMocks(): void {
    // 1. Mock getSupabase to route through InMemoryPostgres with fault injection
    this.spy(supabaseClientModule, 'getSupabase', () => {
      return this.createMockSupabaseClient() as never;
    });

    // 2. Mock Date.now for clock jump tests
    Date.now = () => {
      if (
        this.clockOffsetMs !== 0 &&
        this.armedFault?.fault === 'clock_backwards' &&
        this.armedFault.step === this.currentStep
      ) {
        if (!this.clockBackwardsFired) {
          this.clockBackwardsFired = true;
          this.recordFaultFired();
        }
      }
      return this.originalDateNow() + this.clockOffsetMs;
    };

    // 2b. Intercept IDBObjectStore.get to detect when withDocumentLock encounters concurrent_tab lock
    if (!this.originalIdbGet) {
      const originalGet = IDBObjectStore.prototype.get;
      this.originalIdbGet = originalGet;
      const lockArmedNow = () => this.armedFault?.fault === 'concurrent_tab' && this.currentStep === this.armedFault.step;
      const recordLock = () => this.recordFaultFired();
      IDBObjectStore.prototype.get = function (key: unknown) {
        const req = originalGet.apply(this, [key as IDBValidKey]);
        req.addEventListener('success', () => {
          if (
            lockArmedNow() &&
            req.result &&
            typeof req.result === 'object' &&
            'ownerToken' in req.result &&
            typeof (req.result as { ownerToken?: unknown }).ownerToken === 'string' &&
            ((req.result as { ownerToken: string }).ownerToken.startsWith('concurrent_tab_owner_'))
          ) {
            recordLock();
          }
        });
        return req;
      };
    }

    // 3. Spy on callAi to detect unsolicited AI calls and handle deleteAccount
    this.aiCallsIntercepted = [];
    const mockCallAi = async (name: string, data: unknown) => {
      let consent = false;
      const u = authModule.getCurrentUser();
      if (u) {
        try {
          consent = aiConsentModule.getAiConsent(u.uid);
        } catch {
          // ignore
        }
      }
      if (!['deleteAccount', 'sendTelemetry', 'inviteUser', 'listUsersWithStatus'].includes(name)) {
        this.aiCallsIntercepted.push({
          endpoint: name,
          payload: data,
          consentPresent: consent,
        });
      }

      if (name === 'deleteAccount') {
        const fault = this.shouldTriggerFault();
        if (fault === 'network_pre') {
          this.fireFault();
          throw new TypeError('Failed to fetch (deleteAccount server call failed)');
        }
        if (fault === 'postgres_500') {
          this.fireFault();
          throw new Error('500 Internal Server Error');
        }
        if (u) {
          // Server deletes cloud rows (api/account.ts: local_store_records, then
          // public.users with ON DELETE CASCADE into every user-keyed table).
          // NOTE: The server-side cascade is modeled here in InMemoryPostgres for the client matrix;
          // the real Postgres deletion logic is verified end-to-end in api/__tests__/deleteAccount.db.test.ts (TB-08 Part B).
          for (const t of this.postgres.getTableNamesWithColumn('user_id')) {
            this.postgres.executeDelete(t, [{ type: 'eq', column: 'user_id', value: u.uid }]);
          }
          this.postgres.executeDelete('users', [{ type: 'eq', column: 'uid', value: u.uid }]);
        }
        return { success: true } as never;
      }

      return { success: true } as never;
    };
    this.spy(callAiModule, 'callAi', mockCallAi);

    // 3b. Spy on reauthenticate for deleteAccount (TB-08 Part A)
    this.spy(authModule, 'reauthenticate', async () => {
      // Reauthentication succeeds with 200; account deletion network faults are injected in delete_account step.
      return;
    });

    // 4. Spy on fetch to detect streaming chat endpoint (/api/chat) (GUARD-7).
    // The product maintains two AI doors by design:
    // - callAi: request/response JSON endpoints (summaries, embeddings, rerank)
    // - /api/chat: streaming Server-Sent Events consumed via ReadableStream
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.includes('/api/chat')) {
        let consent = false;
        try {
          const u = authModule.getCurrentUser();
          if (u) {
            consent = aiConsentModule.getAiConsent(u.uid);
          }
        } catch {
          // ignore
        }
        let parsedBody: unknown = undefined;
        try {
          if (typeof init?.body === 'string') {
            parsedBody = JSON.parse(init.body);
          }
        } catch {
          // ignore
        }
        this.aiCallsIntercepted.push({
          endpoint: 'chat',
          payload: parsedBody,
          consentPresent: consent,
        });

        return new Response(
          new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        );
      }

      return originalFetch(input, init);
    };

    this.spy(globalThis, 'fetch', mockFetch);
  }

  public uninstallMocks(): void {
    this.restoreIdbQuotaPatch();
    this.restoreIdbAutoclosePatch();
    if (this.originalIdbGet) {
      IDBObjectStore.prototype.get = this.originalIdbGet;
      this.originalIdbGet = null;
    }
    const globalVi = (globalThis as unknown as { vi?: { restoreAllMocks: () => void } }).vi;
    if (globalVi) {
      globalVi.restoreAllMocks();
    }
    for (const c of this.cleanups) c();
    this.cleanups = [];

    Date.now = this.originalDateNow;
    this.clockOffsetMs = 0;
    this.clockBackwardsFired = false;
    this.faultFiredCount = 0;
    this.aiCallsIntercepted = [];
    this.capturedPayloads = [];
    this.onStep = undefined;
  }

  private shouldTriggerFault(table?: TableName): FaultType | null {
    if (!this.armedFault) return null;
    if (this.armedFault.step !== this.currentStep) return null;
    if (this.armedFault.table && table && this.armedFault.table !== table) return null;
    // R4-031: решение «триггернуть» больше не считается «сработать». Счёт
    // пожаров растёт только там, где сбой реально изменил исход операции
    // (ветки с ошибками ниже, network_post/mid после записи, патчи IDB, замок
    // concurrent_tab при чтении lock-строки) — иначе GT-2 проходила на пустом
    // месте: любой запрос в вооружённом шаге «срабатывал» сбой.
    return this.armedFault.fault;
  }

  private fireFault(): void {
    this.recordFaultFired();
    if (this.armedFault) {
      this.armedFault.currentCount = (this.armedFault.currentCount || 0) + 1;
    }
  }

  public createMockSupabaseClient() {
    return {
      from: (table: TableName) => this.createQueryBuilder(table),
      rpc: (fnName: string, _args: unknown) => {
        const fault = this.shouldTriggerFault();
        if (fault === 'network_pre') {
          this.fireFault();
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        if (fault === 'postgres_500') {
          this.fireFault();
          return Promise.resolve({ data: null, error: { message: `RPC ${fnName} failed`, code: '500' } });
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
        signOut: () => Promise.resolve({ error: null }),
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

    // N-44: как PostgREST, отдаём только запрошенные колонки. Иначе проверка,
    // опирающаяся на колонку, которую запрос не выбирает (владелец, метка),
    // зеленела бы здесь и падала на проде. Сложные выборки (связи, псевдонимы,
    // JSON-пути) — целиком, как раньше.
    let selectCols: string[] | null = null;
    const builder: Record<string, unknown> = {
      select: (cols?: string) => {
        const c = (cols ?? '*').trim();
        selectCols = c === '*' || /[(:>]/.test(c) ? null : c.split(',').map(x => x.trim()).filter(Boolean);
        return builder;
      },
      insert: (payload: unknown) => {
        op = 'insert';
        opPayload = payload;
        this.capturedPayloads.push({ table, op: 'insert', payload });
        return builder;
      },
      upsert: (payload: unknown) => {
        op = 'upsert';
        opPayload = payload;
        this.capturedPayloads.push({ table, op: 'upsert', payload });
        return builder;
      },
      update: (payload: unknown) => {
        op = 'update';
        opPayload = payload;
        this.capturedPayloads.push({ table, op: 'update', payload });
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

          // 1. Fault before execution — сбой изменил исход: считать пожар.
          if (fault === 'network_pre') {
            this.fireFault();
            throw new TypeError('Failed to fetch (offline before request)');
          }
          if (fault === 'abort') {
            this.fireFault();
            throw new DOMException('The user aborted a request.', 'AbortError');
          }
          if (fault === 'postgres_500') {
            this.fireFault();
            return { data: null, error: { message: 'Internal Server Error', code: '500' } };
          }
          if (fault === 'postgres_409') {
            this.fireFault();
            return {
              data: null,
              error: {
                message: 'duplicate key value violates unique constraint "documents_uuid_key"',
                code: '23505',
              },
            };
          }
          if (fault === 'postgres_429') {
            this.fireFault();
            return { data: null, error: { message: 'Too many requests', code: '429' } };
          }
          if (fault === 'decrypt_corrupt_single') {
            this.fireFault();
            await this.corruptSingleCloudVersion();
          }

          if (this.rls) {
            const ownerCol = table === 'users' ? 'uid' : this.postgres.getTableNamesWithColumn('user_id').includes(table) ? 'user_id' : null;
            if (ownerCol) {
              const sessionUid = authModule.getCurrentUser()?.uid ?? null;
              if (op === 'insert' || op === 'upsert') {
                const rows = (Array.isArray(opPayload) ? opPayload : [opPayload]) as Record<string, unknown>[];
                if (rows.some(r => r[ownerCol] !== sessionUid)) {
                  return { data: null, error: { message: `new row violates row-level security policy for table "${table}"`, code: '42501' } };
                }
              } else {
                filters.push({ type: 'eq', column: ownerCol, value: sessionUid });
              }
            }
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
              const cols = selectCols;
              const rows = cols && res.data ? res.data.map(r => Object.fromEntries(cols.map(k => [k, r[k]]))) : res.data;
              let data: Record<string, unknown> | Record<string, unknown>[] | null = rows;
              if (isSingle || isMaybeSingle) {
                data = (rows && rows.length > 0) ? rows[0]! : null;
              }
              result = { data, error: res.error };
              break;
            }
          }

          if (this.onRequest) await this.onRequest(table);

          // 3. Phantom Write (network_post & network_mid):
          // Write succeeded in Postgres, BUT network drops before client gets ACK.
          // Запись уже прошла — сбой изменил исход доставки ACK: считать пожар.
          if (fault === 'network_post') {
            this.fireFault();
            throw new TypeError('Failed to fetch (write committed, ACK dropped by network)');
          }
          if (fault === 'network_mid') {
            this.fireFault();
            throw new Error('Connection aborted by peer (mid-request: write committed to cloud, stream broken)');
          }

          return result;
        };

        return execute().then(resolve, reject);
      },
    };

    return builder;
  }
}
