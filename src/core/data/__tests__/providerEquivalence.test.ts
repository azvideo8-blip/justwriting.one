import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// AUDIT-part3 5: сверка СТАРОГО и НОВОГО SupabaseDataProvider на одном моке
// клиента. Golden-транскрипт снимается с до-распильной версии
// (UPDATE_GOLDEN=1 npm run test -- providerEquivalence), после распила тот же
// харнесс обязан воспроизвести его в точности: и результаты методов, И цепочки
// вызовов клиента (from/select/eq/порядок фильтров), И полезные нагрузки
// insert/update/upsert — то есть маппинг полей обеих сторон.

type Call = { table: string; chain: string[]; payload?: unknown };

function makeMockClient() {
  const calls: Call[] = [];

  const responder = (table: string, terminal: string): { data: unknown; error: unknown } => {
    const row = (o: Record<string, unknown>) => o;
    if (table === 'documents') {
      const doc = row({ uuid: 'doc_1', user_id: 'u1', title: 'T', current_version: 3, total_words: 10, first_session_at: '2026-08-25T10:00:00Z', deleted_at: null, tags: ['a'], label_id: 'l1' });
      return terminal === 'maybeSingle'
        ? { data: doc, error: null }
        : { data: [doc], error: null };
    }
    if (table === 'versions') {
      const v = row({ document_uuid: 'doc_1', user_id: 'u1', version: 2, content: 'c', saved_at: '2026-08-25T11:00:00Z', session_started_at: null });
      return terminal === 'maybeSingle' ? { data: v, error: null } : { data: [v], error: null };
    }
    if (table === 'users' || table === 'admin_users_view') {
      const u = row({ uid: 'u1', email: 'e@x', created_at: '2026-01-01T00:00:00Z', encryption_salt: null });
      if (terminal === 'maybeSingle') return { data: u, error: null };
      return { data: [row({ uid: 'u1', email: 'e@x', role: 'user' })], error: null };
    }
    if (table === 'drafts') {
      const d = row({ user_id: 'u1', title: 'd', content: 'cd', updated_at: '2026-08-25T09:00:00Z' });
      return terminal === 'maybeSingle' ? { data: d, error: null } : { data: [d], error: null };
    }
    if (table === 'ai_summaries') {
      const s = row({ document_id: 'doc_1', user_id: 'u1', summary: 's' });
      return terminal === 'maybeSingle' ? { data: s, error: null } : { data: [s], error: null };
    }
    if (table === 'ai_embeddings') {
      return { data: [row({ document_id: 'doc_1', user_id: 'u1', vectors_json: '[1]', dim: 2 })], error: null };
    }
    if (table === 'local_store_records') {
      const r = row({ store: 'aiDialogues', key: 'k#p1', payload: { a: 1 }, checksum: 'cs' });
      return terminal === 'maybeSingle' ? { data: r, error: null } : { data: [r], error: null };
    }
    return { data: [], error: null };
  };

  /** Цепочный билдер: каждый вызов пишется в транскрипт; терминалы отдают
   *  ответ, любой билдер thenable — fire-and-forget цепочки (.delete().eq())
   *  тоже резолвятся. */
  function makeBuilder(table: string): Record<string, unknown> {
    const chain: string[] = [];
    const b: Record<string, unknown> = {};
    return new Proxy(b, {
      get(_t, prop: string) {
        if (prop === 'then') {
          // Await билдера = финал цепочки без терминала; отдаём конверт.
          calls.push({ table, chain: [...chain, '<await>'] });
          return (res: (v: unknown) => void) => res(responder(table, '<await>'));
        }
        return (...args: unknown[]) => {
          chain.push(`${prop}(${JSON.stringify(args).slice(0, 400)})`);
          if (prop === 'insert' || prop === 'update' || prop === 'upsert' || prop === 'select' || prop === 'rpc') {
            calls.push({ table, chain: [...chain] , payload: prop === 'select' || prop === 'rpc' ? args[0] : args[0] });
          }
          if (prop === 'maybeSingle' || prop === 'single') {
            calls.push({ table, chain: [...chain] });
            return Promise.resolve(responder(table, prop)); // конверт {data,error}
          }
          return makeBuilderFrom(table, chain);
        };
      },
    });
  }

  // Продолжение цепочки с уже накопленным log-ом (замыкание на общий chain).
  function makeBuilderFrom(table: string, chain: string[]): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    return new Proxy(b, {
      get(_t, prop: string) {
        if (prop === 'then') {
          calls.push({ table, chain: [...chain, '<await>'] });
          return (res: (v: unknown) => void) => res(responder(table, '<await>'));
        }
        return (...args: unknown[]) => {
          chain.push(`${prop}(${JSON.stringify(args).slice(0, 400)})`);
          if (prop === 'insert' || prop === 'update' || prop === 'upsert' || prop === 'select' || prop === 'rpc') {
            calls.push({ table, chain: [...chain], payload: args[0] });
          }
          if (prop === 'maybeSingle' || prop === 'single') {
            calls.push({ table, chain: [...chain] });
            return Promise.resolve(responder(table, prop)); // конверт {data,error}
          }
          return makeBuilderFrom(table, chain);
        };
      },
    });
  }

  const channelObj: Record<string, unknown> = {};
  channelObj.on = (...args: unknown[]) => {
    calls.push({ table: 'users', chain: [`channel.on(${JSON.stringify(args[1])})`] });
    return channelObj;
  };
  channelObj.subscribe = () => ({});

  const client = {
    from: (table: string) => makeBuilder(table),
    channel: () => channelObj,
    removeChannel: async () => {},
  };
  return { client, calls };
}

type Provider = Record<string, (...a: unknown[]) => Promise<unknown>>;
const SCENARIOS: Array<{ name: string; run: (p: Provider) => Promise<unknown> }> = [
  { name: 'createDocument', run: p => p['createDocument']!('u1', { title: 'T', currentVersion: 3, tags: ['a'], firstSessionAt: 1756000000000 }) },
  { name: 'getDocument', run: p => p['getDocument']!('u1', 'doc_1') },
  { name: 'getDocumentWithDeleted', run: p => p['getDocumentWithDeleted']!('u1', 'doc_1') },
  { name: 'getUserDocuments', run: p => p['getUserDocuments']!('u1') },
  { name: 'updateDocument', run: p => p['updateDocument']!('u1', 'doc_1', { title: 'T2', mood: null }) },
  { name: 'stats-no-count', run: p => p['updateDocumentSessionStats']!('u1', 'doc_1', { totalWords: 5, totalDuration: 60, currentVersion: 4 }) },
  { name: 'stats-with-count', run: p => p['updateDocumentSessionStats']!('u1', 'doc_1', { totalWords: 5, totalDuration: 60, currentVersion: 4, sessionsCount: 9, lastSessionAt: new Date(1756000000000) }) },
  { name: 'deleteDocument', run: p => p['deleteDocument']!('u1', 'doc_1') },
  { name: 'clearLabelFromAllDocs', run: p => p['clearLabelFromAllDocs']!('u1', 'l1') },
  { name: 'renameTagInAllDocs', run: p => p['renameTagInAllDocs']!('u1', 'a', 'b') },
  { name: 'removeTagFromAllDocs', run: p => p['removeTagFromAllDocs']!('u1', 'a') },
  { name: 'addVersion', run: p => p['addVersion']!('u1', 'doc_1', 'v3', { version: 3, content: 'cc', savedAt: 1756000000000 }) },
  { name: 'getVersions', run: p => p['getVersions']!('u1', 'doc_1') },
  { name: 'getLatestVersion', run: p => p['getLatestVersion']!('u1', 'doc_1') },
  { name: 'updateVersion', run: p => p['updateVersion']!('u1', 'doc_1', 'v3', { content: 'n' }) },
  { name: 'updateVersionsBatch', run: p => p['updateVersionsBatch']!('u1', 'doc_1', [{ versionId: 'v3', data: { content: 'n' } }]) },
  { name: 'deleteVersionsBatch', run: p => p['deleteVersionsBatch']!('u1', 'doc_1', ['v3', 'v4']) },
  { name: 'getProfile', run: p => p['getProfile']!('u1') },
  { name: 'updateProfile', run: p => p['updateProfile']!('u1', { nickname: 'n', privacyAcceptedAt: 1756000000000 }) },
  { name: 'getUsers', run: p => p['getUsers']!(50) },
  { name: 'getDraft', run: p => p['getDraft']!('u1') },
  { name: 'saveDraft', run: p => p['saveDraft']!('u1', { title: 'd', content: 'cd' }) },
  { name: 'updateDraft', run: p => p['updateDraft']!('u1', { title: 'd2' }) },
  { name: 'deleteDraft', run: p => p['deleteDraft']!('u1') },
  { name: 'getSummary', run: p => p['getSummary']!('u1', 'doc_1') },
  { name: 'saveSummary', run: p => p['saveSummary']!('u1', 'doc_1', { summary: 's' }) },
  { name: 'deleteSummary', run: p => p['deleteSummary']!('u1', 'doc_1') },
  { name: 'getUserSummaries', run: p => p['getUserSummaries']!('u1') },
  { name: 'getEmbedding', run: p => p['getEmbedding']!('u1', 'doc_1') },
  { name: 'saveEmbedding', run: p => p['saveEmbedding']!('u1', 'doc_1', { vectorsJson: '[1]', dim: 2 }) },
  { name: 'deleteEmbedding', run: p => p['deleteEmbedding']!('u1', 'doc_1') },
  { name: 'getUserEmbeddingsPaginated', run: p => p['getUserEmbeddingsPaginated']!('u1', 10, 'doc_0') },
  { name: 'getEmbeddingsPage', run: p => p['getEmbeddingsPage']!('u1', 10) },
  { name: 'getAIProfile', run: p => p['getAIProfile']!('u1') },
  { name: 'saveAIProfile', run: p => p['saveAIProfile']!('u1', { nickname: 'n' }) },
  { name: 'getEncryptionMeta', run: p => p['getEncryptionMeta']!('u1') },
  { name: 'saveEncryptionMeta', run: p => p['saveEncryptionMeta']!('u1', { encryptionMeta: { a: 1 } }) },
  { name: 'hasLegacyKey', run: p => p['hasLegacyKey']!('u1') },
  { name: 'getMigrationDrafts', run: p => p['getMigrationDrafts']!('u1') },
  { name: 'executeMigrationBatch', run: p => p['executeMigrationBatch']!([
      { type: 'version', userId: 'u1', documentId: 'doc_1', versionId: 'v3', data: { version: 3, content: 'x' } },
      { type: 'draft', userId: 'u1', draftId: 'u1', data: { title: 'd' } },
      { type: 'document', userId: 'u1', documentId: 'doc_1', data: { title: 'T9' } },
    ]) },
  { name: 'saveLocalStoreRecord', run: p => p['saveLocalStoreRecord']!('u1', 'aiDialogues', 'k', { a: 1 }, 'cs') },
  { name: 'getLocalStoreRecord', run: p => p['getLocalStoreRecord']!('u1', 'aiDialogues', 'k') },
  { name: 'getLocalStoreRecords', run: p => p['getLocalStoreRecords']!('u1', 'aiDialogues') },
  { name: 'deleteLocalStoreRecord', run: p => p['deleteLocalStoreRecord']!('u1', 'aiDialogues', 'k') },
  { name: 'deleteLocalStoreExactRecord', run: p => p['deleteLocalStoreExactRecord']!('u1', 'aiDialogues', 'k') },
  { name: 'deleteLocalStorePagedRecords', run: p => p['deleteLocalStorePagedRecords']!('u1', 'aiDialogues', 'k') },
  { name: 'deleteLocalStoreRecordsByStore', run: p => p['deleteLocalStoreRecordsByStore']!('u1', 'aiDialogues') },
];

// crypto.randomUUID() и настенные часы непредсказуемы между процессами,
// а golden снимался с конкретными значениями — фиксируем их в харнессе, иначе
// сравнение транскрипта краснеет на полях, не связанных с маппингом провайдера.
const GOLDEN_T0 = Date.parse('2026-08-25T06:23:16.895Z');
let clockTick = 0;
class GoldenDate extends Date {
  constructor(...args: unknown[]) {
    if (args.length > 0) super(...args as ConstructorParameters<typeof Date>);
    else super(clockTick++ === 0 ? GOLDEN_T0 : GOLDEN_T0 + 1);
  }
  static now(): number { return GOLDEN_T0; }
}
vi.stubGlobal('Date', GoldenDate);

vi.stubGlobal('crypto', {
  ...globalThis.crypto,
  randomUUID: () => '3157b56c-052e-46a5-9ea7-f113b6c4c67c',
});

vi.mock('../../supabase/client', () => ({
  getSupabase: () => (globalThis as unknown as { __mockClient: { client: unknown } }).__mockClient.client,
}));

const GOLDEN_PATH = resolve(__dirname, '__fixtures__', 'provider-golden.json');

describe('SupabaseDataProvider transcript vs golden (AUDIT-part3 5)', () => {
  const updateGolden = process.env.UPDATE_GOLDEN === '1';

  it('every public method produces the exact same client transcript and results', async () => {
    const mod = await import('../supabaseDataProvider');
    const provider = mod.SupabaseDataProvider as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const mock = makeMockClient();
    (globalThis as unknown as Record<string, unknown>)['__mockClient'] = mock;

    const transcript: Record<string, unknown> = {};
    for (const scenario of SCENARIOS) {
      mock.calls.length = 0;
      let result: unknown;
      let threw: string | null = null;
      try { result = await scenario.run(provider); }
      catch (e) { threw = String((e as Error)?.message ?? e); }
      transcript[scenario.name] = {
        result: threw ? { threw } : JSON.parse(JSON.stringify(result ?? null)),
        calls: JSON.parse(JSON.stringify(mock.calls)),
      };
    }

    if (updateGolden || !existsSync(GOLDEN_PATH)) {
      writeFileSync(GOLDEN_PATH, JSON.stringify(transcript, null, 2));
      console.warn('[equivalence] golden updated');
      return;
    }
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
    expect(transcript).toEqual(golden);
  });

  it('transcript covers every scenario (no silent skips)', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(47);
  });
});
