import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FaultInterceptor } from '../../../testing/faultHarness/faultInterceptor';
import * as authModule from '../../auth';
import { executeMigrationBatch } from '../providers/drafts';

// Первичный ключ versions — суррогатный identity id (0001_schema.sql:60),
// бизнес-ключ — уникальный (document_uuid, version) (:82). PostgREST без
// onConflict целится в первичный ключ: payload без id получает новый id и
// падает на бизнес-ключе (23505). Миграция шифрования обязана указать onConflict.
const UID = 'u_migration_upsert';
const DOC = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeee0004';

describe('executeMigrationBatch: upsert версии с суррогатным первичным ключом', () => {
  let interceptor: FaultInterceptor;

  beforeEach(() => {
    vi.restoreAllMocks();
    interceptor = new FaultInterceptor();
    interceptor.installMocks();
    vi.spyOn(authModule, 'getCurrentUser').mockReturnValue({
      uid: UID,
      email: 'test@example.com',
    } as never);
    interceptor.postgres.setRows('versions', [{
      id: 777,
      user_id: UID,
      document_uuid: DOC,
      version: 1,
      content: 'synthetic-plaintext',
      word_count: 2,
      words_added: 2,
      chars_added: 10,
      duration: 5,
      wpm: 10,
    }]);
  });

  afterEach(() => {
    interceptor.uninstallMocks();
  });

  it('перешифровка существующей версии обновляет тот же ряд, а не вставляет новый', async () => {
    await executeMigrationBatch([{
      type: 'version',
      userId: UID,
      documentId: DOC,
      versionId: 'v1',
      data: { version: 1, content: 'synthetic-ciphertext', _encrypted: true, wordCount: 2 },
    }]);
    const rows = interceptor.postgres.getRows('versions');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(777);
    expect(rows[0]!.content).toBe('synthetic-ciphertext');
    expect(rows[0]!._encrypted).toBe(true);
  });

  it('новая версия той же заметки вставляется отдельным рядом', async () => {
    await executeMigrationBatch([{
      type: 'version',
      userId: UID,
      documentId: DOC,
      versionId: 'v2',
      data: { version: 2, content: 'synthetic-ciphertext-2', _encrypted: true, wordCount: 3 },
    }]);
    const rows = interceptor.postgres.getRows('versions');
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.version === 1)?.content).toBe('synthetic-plaintext');
    expect(rows.find(r => r.version === 2)?.content).toBe('synthetic-ciphertext-2');
  });
});