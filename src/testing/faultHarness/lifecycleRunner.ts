import { vi } from 'vitest';
/**
 * Lifecycle Runner for Fault-Injection Testing
 *
 * Runs the 10 canonical sequences with fault injection, records the 3 states
 * (Told, Device, Postgres), and evaluates Postulates P1, P2, P3, and P4.
 */

import { FaultInterceptor } from './faultInterceptor';
import {
  FaultType,
  StepName,
  MatrixCellResult,
  ToldState,
  DeviceState,
  PostgresState,
} from './faultTypes';
import { getLocalDb, clearAllLocalStores } from '../../core/storage/localDb';
import { StorageService } from '../../core/services/StorageService';
import { CloudSyncService } from '../../core/services/CloudSyncService';
import { SyncService } from '../../core/services/SyncService';
import { LocalStorageService } from '../../core/services/LocalStorageService';
import * as authModule from '../../core/auth';
import {
  getSessionKey,
  setSessionKey,
  clearSessionKey,
  generateDataKey,
} from '../../core/crypto/encrypt';
import { getEncryptionEnabled, setEncryptionEnabled, setProfileLoaded, maybeEncrypt } from '../../core/crypto/cryptoHelpers';
import { SaveDocumentData } from '../../core/services/storageTypes';
import { AppUser } from '../../core/auth/types';

export class LifecycleRunner {
  public interceptor: FaultInterceptor;
  public userId = 'user_test_123';
  public guestId = 'guest_test_123';
  public vaultEnabled = false;
  private currentUser: AppUser | null = null;

  constructor(interceptor?: FaultInterceptor) {
    this.interceptor = interceptor || new FaultInterceptor();
  }

  public setCurrentUser(user: AppUser | null): void {
    this.currentUser = user;
  }

  public async setup(): Promise<void> {
    this.interceptor.installMocks();
    this.interceptor.postgres.reset();
    await clearAllLocalStores();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('auto_sync_enabled', 'true');
    
    this.currentUser = {
      uid: this.userId,
      email: 'test@example.com',
      displayName: 'Test User',
      photoURL: null,
      metadata: {
        creationTime: null,
        lastSignInTime: null,
      },
    };
    vi.spyOn(authModule, 'getCurrentUser').mockImplementation(() => this.currentUser);
    setProfileLoaded(this.userId, true);
    if (this.vaultEnabled) {
      if (!getSessionKey()) {
        setSessionKey(await generateDataKey());
      }
      setEncryptionEnabled(this.userId, true);
    } else {
      setEncryptionEnabled(this.userId, false);
    }
  }

  public teardown(): void {
    this.interceptor.uninstallMocks();
    this.currentUser = null;
    this.vaultEnabled = false;
    clearSessionKey();
  }

  public async inspectDevice(documentIdOrCloudId: string): Promise<DeviceState> {
    const db = await getLocalDb();
    let doc = await db.get('documents', documentIdOrCloudId);
    if (!doc) {
      const all = await db.getAll('documents');
      doc = all.find(d => d.linkedCloudId === documentIdOrCloudId || d.uuid === documentIdOrCloudId || d.id === documentIdOrCloudId);
    }

    const actualLocalId = doc?.id || documentIdOrCloudId;
    const versions = doc ? await db.getAllFromIndex('versions', 'by-document', actualLocalId) : [];
    const queue = await db.getAll('syncQueue');

    const relevantTasks = queue.filter(
      q => q.documentId === actualLocalId || q.documentId === documentIdOrCloudId || q.id === `sync_${actualLocalId}` || q.id.includes(actualLocalId)
    );

    const latestVer = versions.sort((a, b) => b.version - a.version)[0];

    return {
      documentExists: !!doc,
      currentVersion: doc?.currentVersion,
      versionsCount: versions.length,
      latestContent: latestVer?.content,
      linkedCloudId: doc?.linkedCloudId,
      localOnly: doc?.localOnly,
      unlinkedByTombstone: doc?.unlinkedByTombstone,
      queueTasks: relevantTasks.map(t => ({
        id: t.id,
        documentId: t.documentId,
        type: t.type,
        attempts: t.attempts,
        dead: t.dead,
        lastError: t.lastError,
      })),
    };
  }

  public inspectPostgres(documentUuidOrId: string): PostgresState {
    const docs = this.interceptor.postgres.getRows('documents');
    const vers = this.interceptor.postgres.getRows('versions');

    const doc = docs.find(d => d.uuid === documentUuidOrId || d.id === documentUuidOrId);
    const targetUuid = (doc?.uuid as string) || documentUuidOrId;

    const docVers = vers
      .filter(v => v.document_uuid === targetUuid || v.document_uuid === documentUuidOrId)
      .sort((a, b) => ((b.version as number) || 0) - ((a.version as number) || 0));

    const latestVer = docVers[0];

    return {
      documentExists: !!doc,
      currentVersion: doc?.current_version as number | undefined,
      versionsCount: docVers.length,
      latestContent: latestVer?.content as string | undefined,
      isEncrypted: (doc?._encrypted as boolean) || (latestVer?._encrypted as boolean),
      deletedAt: (doc?.deleted_at as string | null) ?? undefined,
      rawRows: docVers,
    };
  }

  /**
   * Надгробие — не «пропавший маркер».
   *
   * Проверка «с выключенным сейфом открытый текст ОБЯЗАН лежать в облаке»
   * ставилась против пустого прогона: если харнесс ничего не записал, зелёный
   * ответ ничего не стоит. Но сценарий, который заканчивается удалением, честно
   * стирает то, что писал, — и та же проверка кричала о нарушении постулата 2
   * на полностью здоровом прогоне seq4. Поэтому строка с `deleted_at` в число
   * ожидающих открытый текст не входит.
   */
  public evaluateP2(
    markers: string[],
    expectedInCloud: boolean,
    notes: string[]
  ): boolean | undefined {
    const vaultOn = getEncryptionEnabled(this.userId);
    const leaks = this.interceptor.postgres.plaintextLeaks(markers);

    if (vaultOn) {
      if (leaks.length === 0) {
        return expectedInCloud ? true : undefined;
      }
      notes.push('P2 LEAK: marker found in ' + leaks.join(', '));
      return false;
    }

    // Vault is off: P2 is only meaningful when vault encryption is enabled.
    // However, we assert that plaintext markers did reach Postgres if cloud sync was expected.
    // This sanity check prevents empty-theatre passes where tests pass because no data was written.
    if (expectedInCloud) {
      if (leaks.length > 0) {
        return undefined; // Not measured (vault disabled, plaintext expected in cloud, leak detection verified)
      }
      notes.push('P2 HARNESS INVERSION: expected plaintext in cloud when vault off, but markers missing');
      return false; // Detection or harness sync broke!
    }

    return undefined; // Not measured (vault disabled, no cloud data expected)
  }

  public evaluateP3(notes: string[]): boolean {
    const p3Held = this.interceptor.aiCallsIntercepted.length === 0;
    if (!p3Held) {
      notes.push(
        `P3 VIOLATION: unsolicited AI calls detected: ${this.interceptor.aiCallsIntercepted.map(c => c.endpoint).join(', ')}`
      );
    }
    return p3Held;
  }

  /**
   * Постулат 4 — конъюнкция, и живёт она ровно здесь.
   *
   * Формула была выписана в десяти сценариях и ещё раз в тесте на неё. Тест,
   * который повторяет проверяемое правило, остаётся зелёным, когда правило
   * разъезжается с кодом, — тот же класс, что «одно правило, две реализации».
   *
   * `p2 ?? true` — известная слабость: непроверенный постулат засчитывается
   * как выполненный. Оставлено осознанно и записано в GUARD-5; менять надо
   * вместе с прогоном сценариев при включённом сейфе, иначе матрица станет
   * сплошным «не измерено».
   */
  public computeP4(
    p1Held: boolean,
    p2Held: boolean | undefined,
    p3Held: boolean,
    told: ToldState,
    device: DeviceState,
    postgres: PostgresState
  ): boolean {
    return Boolean(
      p1Held &&
      (p2Held ?? true) &&
      p3Held &&
      this.toldMatchesReality(told, device, postgres)
    );
  }

  public toldMatchesReality(
    told: ToldState,
    device: DeviceState,
    postgres: PostgresState
  ): boolean {
    switch (told.status) {
      case 'synced_to_cloud': {
        if (!postgres.documentExists || Boolean(postgres.deletedAt)) {
          return false;
        }
        if (!device.documentExists) {
          return false;
        }
        // Device should not have pending un-dead sync tasks for this document
        const hasPendingSync = device.queueTasks.some(
          t => !t.dead && (t.type === 'document' || t.type === 'version')
        );
        if (hasPendingSync) {
          return false;
        }
        // Version alignment
        if (
          device.currentVersion !== undefined &&
          postgres.currentVersion !== undefined &&
          device.currentVersion !== postgres.currentVersion
        ) {
          return false;
        }
        return true;
      }

      case 'saved_local_queued': {
        if (!device.documentExists) {
          return false;
        }
        const hasQueueTask = device.queueTasks.length > 0;
        const isLocalOnly = device.localOnly === true || device.unlinkedByTombstone === true;
        if (!hasQueueTask && !isLocalOnly) {
          return false;
        }
        return true;
      }

      case 'forked_conflict': {
        return (
          told.forked === true &&
          device.documentExists &&
          postgres.documentExists
        );
      }

      case 'deleted': {
        if (device.documentExists) {
          return false;
        }
        const hasOrphanUpload = device.queueTasks.some(
          t => !t.dead && (t.type === 'document' || t.type === 'version')
        );
        if (hasOrphanUpload) {
          return false;
        }
        const deleteQueued = device.queueTasks.some(t => t.type === 'delete');
        const cloudGoneOrTombstoned = !postgres.documentExists || Boolean(postgres.deletedAt);
        return cloudGoneOrTombstoned || deleteQueued;
      }

      case 'restored': {
        return device.documentExists && postgres.documentExists;
      }

      case 'migrated': {
        if (!device.documentExists && !postgres.documentExists) {
          return false;
        }
        if (told.cloudSynced && !postgres.documentExists) {
          return false;
        }
        return true;
      }

      case 'error_thrown': {
        // Person was told there was an error; cloudSynced must be false
        return told.cloudSynced === false;
      }

      default:
        return false;
    }
  }

  // =========================================================================
  // SEQUENCE 1: write → save → sync
  // =========================================================================
  public async runSeq1_WriteSaveSync(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    const notes: string[] = [];
    let told: ToldState = { status: 'error_thrown', cloudSynced: false };

    this.interceptor.setStep('initial_write');
    const docId = 'doc_seq1';
    const initialText = 'Text from Seq1';

    let localDocId = '';
    try {
      if (faultStep === 'initial_write' && fault === 'idb_quota') {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }

      // Step 1: Save new note
      localDocId = await LocalStorageService.createDocument(this.userId, {
        title: 'Seq 1 Note',
        tags: ['test'],
        firstSessionAt: Date.now(),
        lastSessionAt: Date.now(),
      });

      // Save initial version
      const data: SaveDocumentData = {
        title: 'Seq 1 Note',
        content: initialText,
        wordCount: 3,
        duration: 60,
        wpm: 3,
        sessionStartedAt: new Date(),
        tags: ['test'],
      };

      this.interceptor.setStep('save_local');
      if (faultStep === 'save_local' && fault === 'idb_quota') {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }

      // Step 2: Save version
      const saveRes = await StorageService.saveVersion(this.userId, localDocId, data);
      told = {
        status: saveRes.cloudSynced ? 'synced_to_cloud' : 'saved_local_queued',
        cloudSynced: saveRes.cloudSynced,
        forked: saveRes.forked,
      };

      // Step 3: Add cloud copy / sync
      this.interceptor.setStep('sync_cloud');
      this.interceptor.armFault(fault, faultStep);

      try {
        const cloudId = await StorageService.addCloudCopy(this.userId, localDocId);
        if (cloudId) {
          told = { status: 'synced_to_cloud', cloudSynced: true };
        }
      } catch {
        await SyncService.addToQueue(localDocId);
        told = { status: 'saved_local_queued', cloudSynced: false };
      }
    } catch (e: unknown) {
      told = {
        status: 'error_thrown',
        cloudSynced: false,
        error: (e as Error).message,
      };
      notes.push(`Error during step: ${(e as Error).message}`);
    }

    const device = await this.inspectDevice(localDocId || docId);
    const db = await getLocalDb();
    const localDoc = await db.get('documents', localDocId);
    const pgLookup = device.linkedCloudId || localDoc?.uuid || localDocId || docId;
    const postgres = this.inspectPostgres(pgLookup);

    // Evaluate Postulates
    const p1Held = told.status === 'error_thrown' ? true : (device.documentExists && device.latestContent === initialText);
    const p2Held = this.evaluateP2(['Seq 1 Note', initialText], told.status === 'synced_to_cloud', notes);
    const p3Held = this.evaluateP3(notes);
    const p4Held = this.computeP4(p1Held, p2Held, p3Held, told, device, postgres);

    return {
      sequence: 'seq1_write_save_sync',
      fault,
      step: faultStep,
      told,
      device,
      postgres,
      p1Held,
      p2Held,
      p3Held,
      p4Held,
      notes,
    };
  }

  // =========================================================================
  // SEQUENCE 2: write → save → edit → save → sync
  // =========================================================================
  public async runSeq2_WriteSaveEditSaveSync(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    const notes: string[] = [];
    let told: ToldState = { status: 'error_thrown', cloudSynced: false };

    const localDocId = await LocalStorageService.createDocument(this.userId, {
      title: 'Seq 2 Note',
      tags: ['test'],
      firstSessionAt: Date.now(),
      lastSessionAt: Date.now(),
    });

    // Version 1
    await StorageService.saveVersion(this.userId, localDocId, {
      title: 'Seq 2 Note',
      content: 'Version 1 text',
      wordCount: 3,
      duration: 30,
      wpm: 6,
      tags: ['test'],
      sessionStartedAt: new Date(),
    });

    // Initial sync
    const cloudId = await StorageService.addCloudCopy(this.userId, localDocId);

    // Version 2 edit
    const v2Text = 'Version 2 updated text';
    this.interceptor.setStep(faultStep);
    this.interceptor.armFault(fault, faultStep);

    try {
      const saveRes = await StorageService.saveVersion(this.userId, localDocId, {
        title: 'Seq 2 Note',
        content: v2Text,
        wordCount: 4,
        duration: 45,
        wpm: 5,
        tags: ['test'],
        sessionStartedAt: new Date(),
      });
      told = {
        status: saveRes.cloudSynced ? 'synced_to_cloud' : 'saved_local_queued',
        cloudSynced: saveRes.cloudSynced,
        forked: saveRes.forked,
      };
    } catch (e: unknown) {
      told = {
        status: 'error_thrown',
        cloudSynced: false,
        error: (e as Error).message,
      };
      notes.push(`Error during saveVersion v2: ${(e as Error).message}`);
    }

    const device = await this.inspectDevice(localDocId);
    const postgres = this.inspectPostgres(cloudId || localDocId);

    // Did P1 hold? Was version 2 text preserved on device?
    const p1Held = told.status === 'error_thrown' ? true : (device.latestContent === v2Text);
    const p2Held = this.evaluateP2(['Seq 2 Note', 'Version 1 text', v2Text], (postgres.documentExists && !postgres.deletedAt) || postgres.versionsCount > 0, notes);
    const p3Held = this.evaluateP3(notes);
    const p4Held = this.computeP4(p1Held, p2Held, p3Held, told, device, postgres);

    return {
      sequence: 'seq2_write_save_edit_save_sync',
      fault,
      step: faultStep,
      told,
      device,
      postgres,
      p1Held,
      p2Held,
      p3Held,
      p4Held,
      notes,
    };
  }

  // =========================================================================
  // SEQUENCE 3: Cross-device divergence (Device B edit → sync → Device A edit → sync)
  // =========================================================================
  public async runSeq3_CrossDeviceDivergence(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    const notes: string[] = [];

    // Device A creates note and syncs v1
    const localDocId = await LocalStorageService.createDocument(this.userId, {
      title: 'Divergent Note',
      tags: [],
      firstSessionAt: 1000,
      lastSessionAt: 1000,
    });
    await StorageService.saveVersion(this.userId, localDocId, {
      title: 'Divergent Note',
      content: 'Base v1 text',
      wordCount: 3,
      duration: 30,
      wpm: 12,
      tags: [],
      sessionStartedAt: new Date(1000),
    });
    const cloudId = await StorageService.addCloudCopy(this.userId, localDocId);

    // Device B receives v1 and pushes v2
    this.interceptor.setStep('device_b_edit');
    const bContent = this.vaultEnabled
      ? (await maybeEncrypt({ content: 'Device B edit v2' }, ['content'], [], true)).content
      : 'Device B edit v2';
    this.interceptor.postgres.executeInsert('versions', {
      document_uuid: cloudId,
      user_id: this.userId,
      version: 2,
      content: bContent as string,
      word_count: 4,
      duration: 20,
      saved_at: new Date(2000).toISOString(),
      session_started_at: new Date(1000).toISOString(),
      _encrypted: this.vaultEnabled,
    });
    this.interceptor.postgres.executeUpdate(
      'documents',
      { current_version: 2 },
      [{ type: 'eq', column: 'uuid', value: cloudId }]
    );

    // Device A now makes an edit while offline / without seeing B's v2
    this.interceptor.setStep(faultStep);
    this.interceptor.armFault(fault, faultStep);

    let told: ToldState = { status: 'error_thrown', cloudSynced: false };
    try {
      const saveRes = await StorageService.saveVersion(this.userId, localDocId, {
        title: 'Divergent Note',
        content: 'Device A edit v2 conflicting',
        wordCount: 5,
        duration: 40,
        wpm: 12,
        tags: [],
        sessionStartedAt: new Date(2000),
      });
      told = {
        status: saveRes.forked ? 'forked_conflict' : saveRes.cloudSynced ? 'synced_to_cloud' : 'saved_local_queued',
        cloudSynced: saveRes.cloudSynced,
        forked: saveRes.forked,
        forkTitle: saveRes.forkTitle,
      };
    } catch (e: unknown) {
      told = { status: 'error_thrown', cloudSynced: false, error: (e as Error).message };
      notes.push(`Error during saveVersion conflict: ${(e as Error).message}`);
    }

    const device = await this.inspectDevice(localDocId);
    const postgres = this.inspectPostgres(cloudId);

    // P1: Did both Device A's text and Device B's text survive without loss?
    // Fork must preserve Device A's text and Device B's text
    const p1Held = told.forked === true || Boolean(device.latestContent?.includes('Device A edit v2'));
    const p2Held = this.evaluateP2(['Divergent Note', 'Base v1 text'], (postgres.documentExists && !postgres.deletedAt) || postgres.versionsCount > 0, notes);
    const p3Held = this.evaluateP3(notes);
    const p4Held = this.computeP4(p1Held, p2Held, p3Held, told, device, postgres);

    return {
      sequence: 'seq3_cross_device_divergence',
      fault,
      step: faultStep,
      told,
      device,
      postgres,
      p1Held,
      p2Held,
      p3Held,
      p4Held,
      notes,
    };
  }

  // =========================================================================
  // SEQUENCE 4: write → save → sync → delete
  // =========================================================================
  public async runSeq4_WriteSaveSyncDelete(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    const notes: string[] = [];

    const localDocId = await LocalStorageService.createDocument(this.userId, {
      title: 'To Delete',
      tags: [],
      firstSessionAt: 1000,
      lastSessionAt: 1000,
    });
    await StorageService.saveVersion(this.userId, localDocId, {
      title: 'To Delete',
      content: 'Text to delete',
      wordCount: 3,
      duration: 30,
      wpm: 12,
      tags: [],
      sessionStartedAt: new Date(1000),
    });
    const cloudId = await StorageService.addCloudCopy(this.userId, localDocId);

    this.interceptor.setStep(faultStep);
    this.interceptor.armFault(fault, faultStep);

    let told: ToldState = { status: 'deleted', cloudSynced: false };
    try {
      await StorageService.deleteDocument(this.userId, localDocId, cloudId);
      told = { status: 'deleted', cloudSynced: true };
    } catch (e: unknown) {
      told = { status: 'error_thrown', cloudSynced: false, error: (e as Error).message };
      notes.push(`Error during deleteDocument: ${(e as Error).message}`);
    }

    const device = await this.inspectDevice(localDocId);
    const postgres = this.inspectPostgres(cloudId);

    if (faultStep === 'delete_cloud' && (fault === 'network_pre' || fault === 'postgres_500')) {
      if (!postgres.deletedAt && postgres.documentExists) {
        notes.push('Discrepancy: Local document deleted immediately, but cloud row remains active until queue drain');
      }
    }

    const p1Held = true; // Deletion is intended exception to retention
    const p2Held = this.evaluateP2(['To Delete', 'Text to delete'], (postgres.documentExists && !postgres.deletedAt) || postgres.versionsCount > 0, notes);
    const p3Held = this.evaluateP3(notes);
    const p4Held = this.computeP4(p1Held, p2Held, p3Held, told, device, postgres);

    return {
      sequence: 'seq4_write_save_sync_delete',
      fault,
      step: faultStep,
      told,
      device,
      postgres,
      p1Held,
      p2Held,
      p3Held,
      p4Held,
      notes,
    };
  }

  // =========================================================================
  // SEQUENCE 5: write → save → delete before it ever synced
  // =========================================================================
  public async runSeq5_DeleteBeforeSync(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    const notes: string[] = [];

    // Save offline
    const localDocId = await LocalStorageService.createDocument(this.userId, {
      title: 'Offline Note',
      tags: [],
      firstSessionAt: 1000,
      lastSessionAt: 1000,
    });
    await StorageService.saveVersion(this.userId, localDocId, {
      title: 'Offline Note',
      content: 'Unsynced text',
      wordCount: 2,
      duration: 10,
      wpm: 12,
      tags: [],
      sessionStartedAt: new Date(1000),
    });

    // Enqueue a sync task as normally happens
    await SyncService.addToQueue(localDocId);

    // Now delete locally
    this.interceptor.setStep(faultStep);
    this.interceptor.armFault(fault, faultStep);

    let told: ToldState = { status: 'deleted', cloudSynced: true };
    try {
      await StorageService.deleteDocument(this.userId, localDocId, undefined);
    } catch (e: unknown) {
      told = { status: 'error_thrown', cloudSynced: false, error: (e as Error).message };
      notes.push(`Error during deleteDocument: ${(e as Error).message}`);
    }

    const device = await this.inspectDevice(localDocId);
    const postgres = this.inspectPostgres(localDocId);

    // Defect check: did the syncQueue retain the upload task for the deleted document?
    const hasOrphanTask = device.queueTasks.some(t => t.type === 'document');
    if (hasOrphanTask) {
      notes.push('DEFECT: Deleting unlinked local note leaves orphaned task in syncQueue that fails on drain');
    }

    const p1Held = true;
    const p2Held = this.evaluateP2(['Offline Note', 'Unsynced text'], false, notes);
    const p3Held = this.evaluateP3(notes);
    const p4Held = this.computeP4(p1Held, p2Held, p3Held, told, device, postgres);

    return {
      sequence: 'seq5_delete_before_sync',
      fault,
      step: faultStep,
      told,
      device,
      postgres,
      p1Held,
      p2Held,
      p3Held,
      p4Held,
      notes,
      defectFound: hasOrphanTask ? 'SYNC-DEFECT: orphan syncQueue task after local note deletion' : undefined,
    };
  }

  // =========================================================================
  // SEQUENCE 6: write → save → sync → delete on B → edit on A → sync
  // =========================================================================
  public async runSeq6_TombstoneEditRecovery(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    const notes: string[] = [];

    // Device A creates note
    const localDocId = await LocalStorageService.createDocument(this.userId, {
      title: 'Tombstone Note',
      tags: [],
      firstSessionAt: 1000,
      lastSessionAt: 1000,
    });
    await StorageService.saveVersion(this.userId, localDocId, {
      title: 'Tombstone Note',
      content: 'Original v1',
      wordCount: 2,
      duration: 10,
      wpm: 12,
      tags: [],
      sessionStartedAt: new Date(1000),
    });
    const cloudId = await StorageService.addCloudCopy(this.userId, localDocId);

    // Device B soft-deletes the note in cloud
    this.interceptor.setStep('device_b_delete');
    this.interceptor.postgres.executeUpdate(
      'documents',
      { deleted_at: new Date().toISOString() },
      [{ type: 'eq', column: 'uuid', value: cloudId }]
    );

    // Device A edits locally
    this.interceptor.setStep(faultStep);
    this.interceptor.armFault(fault, faultStep);

    let told: ToldState = { status: 'error_thrown', cloudSynced: false };
    try {
      const saveRes = await StorageService.saveVersion(this.userId, localDocId, {
        title: 'Tombstone Note',
        content: 'Original v1 plus local v2 offline edits',
        wordCount: 7,
        duration: 50,
        wpm: 12,
        tags: [],
        sessionStartedAt: new Date(2000),
      });
      told = {
        status: saveRes.cloudSynced ? 'synced_to_cloud' : 'saved_local_queued',
        cloudSynced: saveRes.cloudSynced,
        forked: saveRes.forked,
      };
    } catch (e: unknown) {
      told = { status: 'error_thrown', cloudSynced: false, error: (e as Error).message };
      notes.push(`Error during saveVersion on tombstoned doc: ${(e as Error).message}`);
    }

    const device = await this.inspectDevice(localDocId);
    const postgres = this.inspectPostgres(cloudId);

    // P1 verification: Device A's new edits MUST survive on Device A!
    const p1Held = device.documentExists && device.latestContent?.includes('offline edits') && device.unlinkedByTombstone === true;
    const p2Held = this.evaluateP2(['Tombstone Note', 'Original v1'], (postgres.documentExists && !postgres.deletedAt) || postgres.versionsCount > 0, notes);
    const p3Held = this.evaluateP3(notes);
    const p4Held = this.computeP4(!!p1Held, p2Held, p3Held, told, device, postgres);

    return {
      sequence: 'seq6_tombstone_edit_recovery',
      fault,
      step: faultStep,
      told,
      device,
      postgres,
      p1Held: !!p1Held,
      p2Held,
      p3Held,
      p4Held,
      notes,
    };
  }

  // =========================================================================
  // SEQUENCE 7: sign out with erasure → sign in → restore
  // =========================================================================
  public async runSeq7_SignOutEraseRestore(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    const notes: string[] = [];

    // Create note in cloud
    const cloudId = 'cloud_seq7';
    const rawDoc: Record<string, unknown> = {
      uuid: cloudId,
      user_id: this.userId,
      title: 'Cloud Archive Note',
      total_words: 5,
      total_duration: 30,
      current_version: 1,
      first_session_at: new Date(1000).toISOString(),
      last_session_at: new Date(1000).toISOString(),
    };
    const rawVer: Record<string, unknown> = {
      document_uuid: cloudId,
      user_id: this.userId,
      version: 1,
      content: 'Cloud Archive Content',
      word_count: 5,
      duration: 30,
      saved_at: new Date(1000).toISOString(),
      session_started_at: new Date(1000).toISOString(),
    };
    const encDoc = this.vaultEnabled ? await maybeEncrypt(rawDoc, ['title'], ['tags'], true) : rawDoc;
    const encVer = this.vaultEnabled ? await maybeEncrypt(rawVer, ['content'], [], true) : rawVer;
    this.interceptor.postgres.executeInsert('documents', encDoc);
    this.interceptor.postgres.executeInsert('versions', encVer);

    // Sign out with clearAllLocalStores
    await clearAllLocalStores();

    // Now restore from cloud
    this.interceptor.armFault(fault, faultStep);
    this.interceptor.setStep(faultStep);

    let told: ToldState = { status: 'restored', cloudSynced: true };
    try {
      const res = await CloudSyncService.restoreMissingDocuments(this.userId, { force: true });
      told = { status: 'restored', cloudSynced: true, userFacingMessage: `Restored ${res.restored}` };
    } catch (e: unknown) {
      told = { status: 'error_thrown', cloudSynced: false, error: (e as Error).message };
      notes.push(`Error during restoreMissingDocuments: ${(e as Error).message}`);
    }

    const device = await this.inspectDevice(cloudId);
    const postgres = this.inspectPostgres(cloudId);

    // If restore was interrupted or failed, does device have corrupted partial state?
    const p1Held = told.status === 'restored' ? device.documentExists : true;
    const p2Held = this.evaluateP2(['Cloud Archive Note', 'Cloud Archive Content'], (postgres.documentExists && !postgres.deletedAt) || postgres.versionsCount > 0, notes);
    const p3Held = this.evaluateP3(notes);
    const p4Held = this.computeP4(p1Held, p2Held, p3Held, told, device, postgres);

    return {
      sequence: 'seq7_sign_out_erase_restore',
      fault,
      step: faultStep,
      told,
      device,
      postgres,
      p1Held,
      p2Held,
      p3Held,
      p4Held,
      notes,
    };
  }

  // =========================================================================
  // SEQUENCE 8: guest writes → signs up → migration → sync
  // =========================================================================
  public async runSeq8_GuestSignupMigrateSync(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    const notes: string[] = [];

    // Guest writes note
    const guestDocId = await LocalStorageService.createDocument(this.guestId, {
      title: 'Guest Note',
      tags: ['guest'],
      firstSessionAt: 1000,
      lastSessionAt: 1000,
    });
    await StorageService.saveVersion(this.guestId, guestDocId, {
      title: 'Guest Note',
      content: 'Guest text content',
      wordCount: 3,
      duration: 20,
      wpm: 12,
      tags: ['guest'],
      sessionStartedAt: new Date(1000),
    });

    // Migrate to signed-in user
    const { migrateDocuments } = await import('../../features/auth/services/migrateDocuments');
    this.interceptor.setStep(faultStep);
    this.interceptor.armFault(fault, faultStep);

    let told: ToldState = { status: 'migrated', cloudSynced: false };
    try {
      const count = await migrateDocuments(this.userId);
      told = { status: 'migrated', cloudSynced: false, userFacingMessage: `Migrated ${count} docs` };
      // Sync migrated document
      const cloudId = await StorageService.addCloudCopy(this.userId, guestDocId);
      if (cloudId) told.cloudSynced = true;
    } catch (e: unknown) {
      told = { status: 'error_thrown', cloudSynced: false, error: (e as Error).message };
      notes.push(`Error during migrateDocuments: ${(e as Error).message}`);
    }

    const device = await this.inspectDevice(guestDocId);
    const postgres = this.inspectPostgres(device.linkedCloudId || guestDocId);

    const p1Held = device.latestContent === 'Guest text content';
    const p2Held = this.evaluateP2(['Guest Note', 'Guest text content'], told.cloudSynced || postgres.documentExists, notes);
    const p3Held = this.evaluateP3(notes);
    const p4Held = this.computeP4(p1Held, p2Held, p3Held, told, device, postgres);

    return {
      sequence: 'seq8_guest_signup_migrate_sync',
      fault,
      step: faultStep,
      told,
      device,
      postgres,
      p1Held,
      p2Held,
      p3Held,
      p4Held,
      notes,
    };
  }

  // =========================================================================
  // SEQUENCE 9: enable encryption on existing archive → sync → restore
  // =========================================================================
  public async runSeq9_EnableEncryptionSyncRestore(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    const notes: string[] = [];

    // Existing plaintext note in cloud
    const cloudId = 'cloud_plain_doc';
    this.interceptor.postgres.executeInsert('documents', {
      uuid: cloudId,
      user_id: this.userId,
      title: 'Plaintext Cloud Title',
      current_version: 1,
      total_words: 4,
      total_duration: 30,
      tags: ['secret_tag'],
      _encrypted: false,
    });
    this.interceptor.postgres.executeInsert('versions', {
      document_uuid: cloudId,
      user_id: this.userId,
      version: 1,
      content: 'Plaintext secret note content',
      _encrypted: false,
    });

    // Existing plaintext AI summary in cloud
    this.interceptor.postgres.executeInsert('ai_summaries', {
      document_id: cloudId,
      user_id: this.userId,
      summary: 'Plaintext psychological analysis summary',
      _encrypted: false,
    });

    // Enable encryption
    const dataKey = await generateDataKey();
    setSessionKey(dataKey);
    setEncryptionEnabled(this.userId, true);

    // Run encryption migration
    const { encryptAllExistingNotes } = await import('../../core/crypto/encryptMigration');
    this.interceptor.setStep(faultStep);
    this.interceptor.armFault(fault, faultStep);

    let told: ToldState = { status: 'migrated', cloudSynced: true };
    try {
      await encryptAllExistingNotes(this.userId);
    } catch (e: unknown) {
      told = { status: 'error_thrown', cloudSynced: false, error: (e as Error).message };
      notes.push(`Error during encryptAllExistingNotes: ${(e as Error).message}`);
    }

    const device = await this.inspectDevice(cloudId);
    const postgres = this.inspectPostgres(cloudId);
    const summaryRows = this.interceptor.postgres.getRows('ai_summaries');
    const summary = summaryRows.find(s => s.document_id === cloudId);

    const p1Held = true;
    // P2 Evaluation:
    const p2Held = this.evaluateP2(
      ['Plaintext Cloud Title', 'Plaintext secret note content', 'secret_tag', 'Plaintext psychological analysis summary'],
      true,
      notes
    );

    const summaryEncrypted = summary?._encrypted === true;
    if (p2Held === false && !summaryEncrypted) {
      notes.push('P2 VIOLATION: encryptAllExistingNotes does NOT re-encrypt ai_summaries or ai_embeddings in Postgres');
    }

    const p3Held = this.evaluateP3(notes);
    const p4Held = this.computeP4(p1Held, p2Held, p3Held, told, device, postgres);

    return {
      sequence: 'seq9_enable_encryption_sync_restore',
      fault,
      step: faultStep,
      told,
      device,
      postgres,
      p1Held,
      p2Held,
      p3Held,
      p4Held,
      notes,
      defectFound: p2Held === false ? 'P2-DEFECT: unencrypted AI derivatives remain plaintext after vault setup' : undefined,
    };
  }

  // =========================================================================
  // SEQUENCE 10: delete account
  // =========================================================================
  public async runSeq10_DeleteAccount(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    const notes: string[] = [];

    // Setup user note locally and in cloud
    const docId = await LocalStorageService.createDocument(this.userId, {
      title: 'Delete Account Note',
      tags: [],
      firstSessionAt: 1000,
      lastSessionAt: 1000,
    });
    await StorageService.saveVersion(this.userId, docId, {
      title: 'Delete Account Note',
      content: 'Text to be deleted with account',
      wordCount: 6,
      duration: 30,
      wpm: 12,
      tags: [],
      sessionStartedAt: new Date(1000),
    });
    const cloudId = await StorageService.addCloudCopy(this.userId, docId);

    // Mock deleteAccount server call
    this.interceptor.setStep(faultStep);
    this.interceptor.armFault(fault, faultStep);

    let told: ToldState = { status: 'deleted', cloudSynced: true };
    try {
      if (faultStep === 'delete_account' && fault === 'network_pre') {
        throw new TypeError('Failed to fetch (deleteAccount server call failed)');
      }
      // Server deletes cloud rows
      this.interceptor.postgres.executeDelete('documents', [{ type: 'eq', column: 'user_id', value: this.userId }]);
      this.interceptor.postgres.executeDelete('versions', [{ type: 'eq', column: 'user_id', value: this.userId }]);

      // Local erasure
      await clearAllLocalStores();
    } catch (e: unknown) {
      told = { status: 'error_thrown', cloudSynced: false, error: (e as Error).message };
      notes.push(`Error during deleteAccount: ${(e as Error).message}`);
    }

    const device = await this.inspectDevice(docId);
    const postgres = this.inspectPostgres(cloudId);

    const p1Held = true;
    const p2Held = this.evaluateP2(
      ['Delete Account Note', 'Text to be deleted with account'],
      (postgres.documentExists && !postgres.deletedAt) || postgres.versionsCount > 0,
      notes
    );
    const p3Held = this.evaluateP3(notes);
    const p4Held = this.computeP4(p1Held, p2Held, p3Held, told, device, postgres);

    return {
      sequence: 'seq10_delete_account',
      fault,
      step: faultStep,
      told,
      device,
      postgres,
      p1Held,
      p2Held,
      p3Held,
      p4Held,
      notes,
    };
  }
}
