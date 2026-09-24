import { describe, it, expect, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import { getLocalDb } from '../../../core/storage/localDb';
import { SyncService } from '../../../core/services/SyncService';

/**
 * Next-steps №1: the server as a hostile channel. The vault encrypts titles and
 * texts with a key the server never sees (AES-GCM, authenticated) — so a server
 * cannot forge a note. Unless the client takes a row marked «not encrypted» at
 * face value.
 */
describe('№1: hostile server', () => {
  const runner = new LifecycleRunner();
  afterEach(() => runner.teardown());

  it('with the vault on, a plaintext row the server made up is not taken as a note', async () => {
    runner.vaultEnabled = true;
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    pg.executeInsert('documents', { uuid: 'forged-doc', user_id: uid, title: 'Письмо от банка', current_version: 1, _encrypted: false, first_session_at: 1000, last_session_at: 1000, tags: [] });
    pg.executeInsert('versions', { document_uuid: 'forged-doc', user_id: uid, version: 1, content: 'Срочно перейдите по ссылке и введите пароль', _encrypted: false, word_count: 7, duration: 1, wpm: 1, session_started_at: new Date(1000).toISOString() });

    await SyncService.downloadAllFromCloud(uid);
    const db = await getLocalDb();
    const texts = (await db.getAll('versions')).map(v => v.content);
    expect(texts).not.toContain('Срочно перейдите по ссылке и введите пароль');
  });
});
