import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { SyncService } from '../../services/SyncService';
import { StorageService } from '../../services/StorageService';
import { classifySyncError, isPoisonSyncError, isRevivableOnUnlock, SYNC_ERROR_RULES } from '../classifySyncError';

vi.mock('../cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));

const USER = 'user_classify_test';

describe('DUP-4 / FU-2 / FU-6: classifySyncError, isPoisonSyncError, and isRevivableOnUnlock', () => {
  beforeEach(async () => {
    const db = await getLocalDb(USER);
    await db.clear('documents');
    await db.clear('syncQueue');
    vi.restoreAllMocks();
  });

  describe('unit classification and predicates', () => {
    it('classifies blocked-until-unlock errors case-insensitively', () => {
      expect(classifySyncError('LOCKED: cannot add cloud copy')).toBe('blocked-until-unlock');
      expect(classifySyncError('locked: cannot sync')).toBe('blocked-until-unlock');
      expect(classifySyncError(new Error('Document is locked'))).toBe('blocked-until-unlock');
      expect(classifySyncError('ENCRYPT_REQUIRED: vault key needed')).toBe('blocked-until-unlock');
      expect(classifySyncError('DECRYPT_FAILED_LATEST: cloud document c1 version 2')).toBe('blocked-until-unlock');
    });

    it('classifies permanent errors', () => {
      expect(classifySyncError('DECRYPTION_ERROR: corrupted ciphertext')).toBe('permanent');
      expect(classifySyncError(new Error('Invalid sessionStartedAt for version v1'))).toBe('permanent');
      expect(classifySyncError(new Error('Document too large for cloud sync (900KB estimated)...'))).toBe('permanent');
      expect(classifySyncError('DUPLICATE_UUID_COLLISION: uuid collision in local store')).toBe('permanent');
      expect(classifySyncError(new Error('Cloud document not found'))).toBe('permanent');
      expect(classifySyncError(new Error('EMPTY_CLOUD_DOCUMENT: Cloud document has no versions'))).toBe('permanent');
    });

    it('classifies transient errors (including SYNC_UNRESOLVED which is not a poison pill)', () => {
      expect(classifySyncError('Network timeout')).toBe('transient');
      expect(classifySyncError(new Error('HTTP 503 Service Unavailable'))).toBe('transient');
      expect(classifySyncError('SYNC_UNRESOLVED: conflict awaiting unlock')).toBe('transient');
      expect(classifySyncError(null)).toBe('transient');
      expect(classifySyncError(undefined)).toBe('transient');
    });

    it('DE-7: fetch, не дошедший до сервера, — network во всех браузерах', () => {
      expect(classifySyncError(new TypeError('Failed to fetch'))).toBe('network');
      expect(classifySyncError({ message: 'TypeError: Failed to fetch', code: '' })).toBe('network');
      expect(classifySyncError(new TypeError('Load failed'))).toBe('network');
      expect(classifySyncError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe('network');
      expect(isPoisonSyncError(new TypeError('Failed to fetch'))).toBe(false);
    });

    // Н-2 (дейлик 21.11): 429 — «притормози», пауза без попытки. Форма ошибки — стенд FD
    // (supabase-js отдаёт только message со страницей nginx). Мутация: 'transient' → красный.
    it('429 — пауза, а не попытка; номер 429 в чужом тексте — не 429', () => {
      expect(classifySyncError({ message: '<html><h1>429 Too Many Requests</h1></html>' })).toBe('network');
      expect(classifySyncError(new Error('<h1>429 Too Many Requests</h1>'))).toBe('network');
      expect(classifySyncError({ code: '429', message: 'x' })).toBe('network');
      expect(classifySyncError('429 Too Many Requests')).toBe('network');
      expect(classifySyncError(new Error('DECRYPT_FAILED_LATEST: cloud document c1 version 429'))).toBe('blocked-until-unlock');
      expect(classifySyncError(new Error('row 429 refused'))).toBe('transient');
    });

    it('identifies poison pill errors (quarantined on attempt 1)', () => {
      expect(isPoisonSyncError('LOCKED: vault locked')).toBe(true);
      expect(isPoisonSyncError('ENCRYPT_REQUIRED: key needed')).toBe(true);
      expect(isPoisonSyncError('DECRYPT_FAILED_LATEST: cloud document c1 version 2')).toBe(true);
      expect(isPoisonSyncError('DECRYPTION_ERROR: bad ciphertext')).toBe(true);
      expect(isPoisonSyncError(new Error('Invalid sessionStartedAt'))).toBe(true);
      // SYNC_UNRESOLVED is NOT poison — it gets normal retries
      expect(isPoisonSyncError('SYNC_UNRESOLVED: conflict')).toBe(false);
      expect(isPoisonSyncError('Network timeout')).toBe(false);
      expect(isPoisonSyncError(null)).toBe(false);
    });

    it('identifies errors revivable on vault unlock', () => {
      expect(isRevivableOnUnlock('LOCKED: vault locked')).toBe(true);
      expect(isRevivableOnUnlock('locked')).toBe(true);
      expect(isRevivableOnUnlock('ENCRYPT_REQUIRED: key needed')).toBe(true);
      expect(isRevivableOnUnlock('DECRYPT_FAILED_LATEST: cloud document c1 version 2')).toBe(true);
      expect(isRevivableOnUnlock('SYNC_UNRESOLVED: conflict')).toBe(true);
      // Corrupted data is NOT revivable by vault unlock
      expect(isRevivableOnUnlock('DECRYPTION_ERROR: bad ciphertext')).toBe(false);
      expect(isRevivableOnUnlock('Invalid sessionStartedAt')).toBe(false);
      expect(isRevivableOnUnlock('Network timeout')).toBe(false);
      expect(isRevivableOnUnlock(null)).toBe(false);
    });

    it('FU-6: matches all 6 rules in SYNC_ERROR_RULES consistently', () => {
      for (const rule of SYNC_ERROR_RULES) {
        const errorMsg = `Error occurred: ${rule.code} in sync operation`;
        expect(isPoisonSyncError(errorMsg)).toBe(rule.poison);
        expect(isRevivableOnUnlock(errorMsg)).toBe(rule.revivableOnUnlock);
        expect(classifySyncError(errorMsg)).toBe(rule.category);
      }
    });

    it('FU-6: respects word boundaries and does NOT match UNLOCKED as LOCKED', () => {
      expect(isPoisonSyncError('vault is UNLOCKED')).toBe(false);
      expect(isRevivableOnUnlock('vault is UNLOCKED')).toBe(false);
      expect(classifySyncError('vault is UNLOCKED')).toBe('transient');

      expect(isPoisonSyncError('ALREADY_LOCKED')).toBe(false);
      expect(isRevivableOnUnlock('ALREADY_LOCKED')).toBe(false);

      expect(isPoisonSyncError('LOCKED_FILE')).toBe(false);
      expect(isRevivableOnUnlock('LOCKED_FILE')).toBe(false);
    });

    it('FU-6: matches structured error objects by code or nested error code', () => {
      expect(isPoisonSyncError({ code: 'LOCKED' })).toBe(true);
      expect(isRevivableOnUnlock({ code: 'LOCKED' })).toBe(true);
      expect(classifySyncError({ code: 'LOCKED' })).toBe('blocked-until-unlock');

      expect(isPoisonSyncError({ error: { code: 'ENCRYPT_REQUIRED' } })).toBe(true);
      expect(isRevivableOnUnlock({ error: { code: 'ENCRYPT_REQUIRED' } })).toBe(true);
      expect(classifySyncError({ error: { code: 'ENCRYPT_REQUIRED' } })).toBe('blocked-until-unlock');

      expect(isPoisonSyncError({ code: 'DECRYPTION_ERROR' })).toBe(true);
      expect(isRevivableOnUnlock({ code: 'DECRYPTION_ERROR' })).toBe(false);
      expect(classifySyncError({ code: 'DECRYPTION_ERROR' })).toBe('permanent');
    });

    it('T-3: classifies Postgres error codes 23514, 22001, 22P02 as permanent and poison', () => {
      for (const code of ['23514', '22001', '22P02']) {
        const err = { code, message: `Postgres error ${code}` };
        expect(classifySyncError(err)).toBe('permanent');
        expect(isPoisonSyncError(err)).toBe(true);
        expect(isRevivableOnUnlock(err)).toBe(false);
      }
    });
  });

  describe('integration with SyncService quarantine and revival', () => {
    async function queueTask(id: string) {
      const db = await getLocalDb(USER);
      await db.put('documents', {
        id, guestId: USER, title: 'Note', currentVersion: 1, totalWords: 1,
        totalDuration: 0, sessionsCount: 1, tags: [], linkedCloudId: '',
      } as never);
      await db.put('syncQueue', {
        id: `sync_${id}`,
        documentId: id,
        type: 'document' as const,
        createdAt: Date.now(),
        ownerId: USER,
      });
    }

    it('locked task (uppercase LOCKED) is quarantined immediately and revived on unlock', async () => {
      await queueTask('doc_LOCKED');
      vi.spyOn(StorageService, 'addCloudCopy').mockRejectedValueOnce(
        new Error('LOCKED: cannot add cloud copy of locked document'),
      );
      await SyncService.syncPending(USER);

      const db = await getLocalDb(USER);
      let task = await db.get('syncQueue', 'sync_doc_LOCKED');
      expect(task?.dead).toBe(true);

      const revivedUpper = await SyncService.reviveLockedTasks(USER);
      expect(revivedUpper).toBe(1);
      task = await db.get('syncQueue', 'sync_doc_LOCKED');
      expect(task?.dead).toBe(false);
    });

    it('locked task (lowercase locked) is quarantined immediately and revived on unlock', async () => {
      await queueTask('doc_locked_lower');
      vi.spyOn(StorageService, 'addCloudCopy').mockRejectedValueOnce(
        new Error('locked: vault is locked'),
      );
      await SyncService.syncPending(USER);

      const db = await getLocalDb(USER);
      let task = await db.get('syncQueue', 'sync_doc_locked_lower');
      expect(task?.dead).toBe(true);

      const revivedLower = await SyncService.reviveLockedTasks(USER);
      expect(revivedLower).toBe(1);
      task = await db.get('syncQueue', 'sync_doc_locked_lower');
      expect(task?.dead).toBe(false);
    });

    it('permanent tasks are quarantined immediately and NEVER revived by reviveLockedTasks', async () => {
      await queueTask('doc_perm_decrypt');
      await queueTask('doc_perm_date');

      vi.spyOn(StorageService, 'addCloudCopy')
        .mockRejectedValueOnce(new Error('DECRYPTION_ERROR: bad ciphertext'))
        .mockRejectedValueOnce(new Error('Invalid sessionStartedAt for version 1'));

      await SyncService.syncPending(USER);

      const db = await getLocalDb(USER);
      const decryptTask = await db.get('syncQueue', 'sync_doc_perm_decrypt');
      const dateTask = await db.get('syncQueue', 'sync_doc_perm_date');

      expect(decryptTask?.dead).toBe(true);
      expect(dateTask?.dead).toBe(true);

      // Attempt revive: neither permanent error should be revived
      const revived = await SyncService.reviveLockedTasks(USER);
      expect(revived).toBe(0);

      const decryptTaskAfter = await db.get('syncQueue', 'sync_doc_perm_decrypt');
      const dateTaskAfter = await db.get('syncQueue', 'sync_doc_perm_date');
      expect(decryptTaskAfter?.dead).toBe(true);
      expect(dateTaskAfter?.dead).toBe(true);
    });

    it('SYNC_UNRESOLVED is not quarantined on attempt 1, but is revived on unlock if dead', async () => {
      await queueTask('doc_sync_unresolved');
      vi.spyOn(StorageService, 'addCloudCopy').mockRejectedValueOnce(
        new Error('SYNC_UNRESOLVED: conflict awaiting unlock'),
      );

      await SyncService.syncPending(USER);

      const db = await getLocalDb(USER);
      let task = await db.get('syncQueue', 'sync_doc_sync_unresolved');
      // Attempt 1: not dead, attempts bumped to 1
      expect(task?.dead).toBeFalsy();
      expect(task?.attempts).toBe(1);

      // Now simulate exhausting retries or quarantine
      await db.put('syncQueue', {
        ...task!,
        dead: true,
        attempts: 10,
        lastError: 'SYNC_UNRESOLVED: conflict awaiting unlock',
      });

      const revived = await SyncService.reviveLockedTasks(USER);
      expect(revived).toBe(1);

      task = await db.get('syncQueue', 'sync_doc_sync_unresolved');
      expect(task?.dead).toBe(false);
      expect(task?.attempts).toBe(0);
    });

    it('L-7: task failing with DECRYPT_FAILED_LATEST is quarantined immediately and revived on unlock', async () => {
      await queueTask('doc_decrypt_latest');
      vi.spyOn(StorageService, 'addCloudCopy').mockRejectedValueOnce(
        new Error('DECRYPT_FAILED_LATEST: cloud document cloud_1 version 2'),
      );
      await SyncService.syncPending(USER);

      const db = await getLocalDb(USER);
      let task = await db.get('syncQueue', 'sync_doc_decrypt_latest');
      expect(task?.dead).toBe(true);

      const revived = await SyncService.reviveLockedTasks(USER);
      expect(revived).toBe(1);
      task = await db.get('syncQueue', 'sync_doc_decrypt_latest');
      expect(task?.dead).toBe(false);
    });
  });

  describe('L-7: unit test DECRYPT_FAILED_LATEST rule attributes', () => {
    it('produces category: blocked-until-unlock, poison: true, revivableOnUnlock: true', () => {
      const err = new Error('DECRYPT_FAILED_LATEST: cloud document cloud_123 version 3');
      expect(classifySyncError(err)).toBe('blocked-until-unlock');
      expect(isPoisonSyncError(err)).toBe(true);
      expect(isRevivableOnUnlock(err)).toBe(true);
    });
  });
});
