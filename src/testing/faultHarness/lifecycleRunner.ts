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
    this.interceptor.clearArmedFault();
    this.interceptor.setStep('initial_write');
    this.interceptor.installMocks();
    this.interceptor.postgres.reset();
    this.interceptor.capturedPayloads = [];
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
    const globalVi = (globalThis as unknown as { vi?: { spyOn: (obj: unknown, fn: string) => { mockImplementation: (impl: () => unknown) => void } } }).vi;
    if (globalVi) {
      globalVi.spyOn(authModule, 'getCurrentUser').mockImplementation(() => this.currentUser);
    } else {
      (authModule as unknown as { getCurrentUser: () => AppUser | null }).getCurrentUser = () => this.currentUser;
    }
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

  public async inspectDevice(documentIdOrCloudId: string, cloudId?: string): Promise<DeviceState> {
    const db = await getLocalDb();
    let doc = await db.get('documents', documentIdOrCloudId);
    if (!doc) {
      const all = await db.getAll('documents');
      doc = all.find(d => d.linkedCloudId === documentIdOrCloudId || d.uuid === documentIdOrCloudId || d.id === documentIdOrCloudId);
    }

    const actualLocalId = doc?.id || documentIdOrCloudId;
    const targetCloudId = cloudId || doc?.linkedCloudId;
    const versions = doc ? await db.getAllFromIndex('versions', 'by-document', actualLocalId) : [];
    const queue = await db.getAll('syncQueue');

    const relevantTasks = queue.filter(
      q => q.documentId === actualLocalId ||
           q.documentId === documentIdOrCloudId ||
           (Boolean(targetCloudId) && q.documentId === targetCloudId) ||
           q.id === `sync_${actualLocalId}` ||
           q.id.includes(actualLocalId) ||
           (Boolean(targetCloudId) && (q.id === `delete_${targetCloudId}` || (targetCloudId !== undefined && q.id.includes(targetCloudId))))
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
    notes: string[],
    checkCapturedPayloads = false
  ): boolean | undefined {
    const vaultOn = getEncryptionEnabled(this.userId);
    const leaks = this.interceptor.postgres.plaintextLeaks(markers);

    if (vaultOn) {
      if (leaks.length === 0) {
        if (expectedInCloud) return true;
        // Even if request didn't reach DB (network_pre, 500, 409, 429, abort in seq1),
        // check whether an outgoing payload was prepared and properly encrypted.
        if (checkCapturedPayloads && this.interceptor.capturedPayloads.length > 0) {
          const payloadLeaks = this.interceptor.payloadLeaks(markers);
          if (payloadLeaks.length > 0) {
            notes.push('P2 LEAK: marker found in outgoing payload: ' + payloadLeaks.join(', '));
            return false;
          }
          return true; // Outgoing payload was verified encrypted!
        }
        return undefined;
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
   * Postulate 4 is the conjunction:
   * saved, encrypted, synchronised, nothing leaked, apart from what the person deliberately sent.
   *
   * Three-valued logic (GUARD-6):
   * - false if any leg is false (including toldMatchesReality === false)
   * - undefined if no leg is false but some leg is unmeasured (undefined)
   * - true only when every leg was measured and held
   */
  public computeP4(
    p1Held: boolean | undefined,
    p2Held: boolean | undefined,
    p3Held: boolean | undefined,
    told: ToldState,
    device: DeviceState,
    postgres: PostgresState
  ): boolean | undefined {
    const realityMatches = this.toldMatchesReality(told, device, postgres);
    if (p1Held === false || p2Held === false || p3Held === false || realityMatches === false) {
      return false;
    }
    if (p1Held === undefined || p2Held === undefined || p3Held === undefined) {
      return undefined;
    }
    return true;
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
        const cloudGoneOrTombstoned = !postgres.documentExists || Boolean(postgres.deletedAt);
        return cloudGoneOrTombstoned;
      }

      case 'deleted_local_queued': {
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
        return deleteQueued;
      }

      case 'restored': {
        return device.documentExists && postgres.documentExists;
      }

      case 'migrated': {
        if (!device.documentExists) {
          return false;
        }
        if (!postgres.documentExists || Boolean(postgres.deletedAt)) {
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
    this.interceptor.resetFaultFired();
    this.interceptor.armFault(fault, faultStep);
    const notes: string[] = [];
    let told: ToldState = { status: 'error_thrown', cloudSynced: false };

    this.interceptor.setStep('initial_write');
    const docId = 'doc_seq1';
    const initialText = 'Text from Seq1';

    let localDocId = '';
    try {
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
        mood: '😊',
      };

      this.interceptor.setStep('save_local');

      // Step 2: Save version
      try {
        const saveRes = await StorageService.saveVersion(this.userId, localDocId, data);
        told = {
          status: saveRes.cloudSynced ? 'synced_to_cloud' : 'saved_local_queued',
          cloudSynced: saveRes.cloudSynced,
          forked: saveRes.forked,
        };
      } catch (e: unknown) {
        if (fault === 'idb_quota') {
          // DC-3: After quota failure, user frees space and retries save:
          // Clear armed fault, retry saveVersion with the same data
          this.interceptor.clearArmedFault();
          const retryRes = await StorageService.saveVersion(this.userId, localDocId, data);
          told = {
            status: retryRes.cloudSynced ? 'synced_to_cloud' : 'saved_local_queued',
            cloudSynced: retryRes.cloudSynced,
            forked: retryRes.forked,
          };
        } else {
          throw e;
        }
      }

      // Step 3: Add cloud copy / sync
      this.interceptor.setStep('sync_cloud');
      if (fault !== 'idb_quota') {
        this.interceptor.armFault(fault, faultStep);
      }
      if (fault === 'concurrent_tab') {
        await this.interceptor.applyConcurrentTabLock(localDocId);
      }

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
    let p1Held: boolean;
    if (fault === 'idb_quota') {
      p1Held = Boolean(device.documentExists && device.latestContent === initialText && device.versionsCount === 1);
    } else {
      p1Held = told.status === 'error_thrown' ? true : Boolean(device.documentExists && device.latestContent === initialText);
    }

    const cloudExists = (postgres.documentExists && !postgres.deletedAt) && postgres.versionsCount >= 1;
    let p2Held: boolean | undefined;
    if (fault === 'idb_quota') {
      const vaultOn = getEncryptionEnabled(this.userId);
      if (vaultOn) {
        if (!cloudExists) {
          notes.push('P2 VIOLATION: note expected in cloud after quota retry, but missing');
          p2Held = false;
        } else {
          const evalRes = this.evaluateP2(
            ['Seq 1 Note', initialText, '😊'],
            true,
            notes,
            true
          );
          p2Held = evalRes === true ? true : false;
        }
      } else {
        p2Held = this.evaluateP2(
          ['Seq 1 Note', initialText, '😊'],
          cloudExists,
          notes,
          true
        );
      }
    } else {
      p2Held = this.evaluateP2(
        ['Seq 1 Note', initialText, '😊'],
        (postgres.documentExists && !postgres.deletedAt) || postgres.versionsCount > 0,
        notes,
        true
      );
    }
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
      faultFired: this.interceptor.getFaultFiredCount(),
    };
  }

  // =========================================================================
  // SEQUENCE 2: write → save → edit → save → sync
  // =========================================================================
  public async runSeq2_WriteSaveEditSaveSync(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    this.interceptor.resetFaultFired();
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
    if (fault === 'concurrent_tab') {
      await this.interceptor.applyConcurrentTabLock(localDocId);
    }

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
    // For idb_tx_autoclose the v2 write aborted so v1 must exist; for all other faults (including concurrent_tab) v2 was saved locally.
    const p1Held = (told.status === 'error_thrown' && fault === 'idb_tx_autoclose')
      ? device.documentExists
      : (device.latestContent === v2Text);
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
      faultFired: this.interceptor.getFaultFiredCount(),
    };
  }

  // =========================================================================
  // SEQUENCE 3: Cross-device divergence (Device B edit → sync → Device A edit → sync)
  // =========================================================================
  public async runSeq3_CrossDeviceDivergence(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    this.interceptor.resetFaultFired();
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

    if (fault === 'decrypt_corrupt_single') {
      if (!this.vaultEnabled) {
        return {
          sequence: 'seq3_cross_device_divergence',
          fault,
          step: faultStep,
          told: { status: 'synced_to_cloud', cloudSynced: false },
          device: await this.inspectDevice(localDocId),
          postgres: this.inspectPostgres(''),
          p1Held: undefined,
          p2Held: undefined,
          p3Held: this.evaluateP3(notes),
          p4Held: undefined,
          notes: ['Skipped: decrypt_corrupt_single requires vaultEnabled=true'],
          faultFired: this.interceptor.getFaultFiredCount(),
        };
      }

      // CHOKE-1 audit scenario:
      // Device A saves and syncs its own v2
      await StorageService.saveVersion(this.userId, localDocId, {
        title: 'Divergent Note',
        content: 'Device A own v2 text',
        wordCount: 5,
        duration: 25,
        wpm: 12,
        tags: [],
        sessionStartedAt: new Date(1500),
      });

      // Cloud v2 is corrupted under a foreign key (causes DecryptionError on read)
      await this.interceptor.corruptSingleCloudVersion(2);

      // Device B pushes readable v3 to cloud
      this.interceptor.setStep('device_b_edit');
      const bContentV3 = (await maybeEncrypt({ content: 'Device B edit v3' }, ['content'], [], true)).content;
      this.interceptor.postgres.executeInsert('versions', {
        document_uuid: cloudId,
        user_id: this.userId,
        version: 3,
        content: bContentV3 as string,
        word_count: 4,
        duration: 20,
        saved_at: new Date(2500).toISOString(),
        session_started_at: new Date(2000).toISOString(),
        _encrypted: true,
      });
      this.interceptor.postgres.executeUpdate(
        'documents',
        { current_version: 3 },
        [{ type: 'eq', column: 'uuid', value: cloudId }]
      );

      // Device A now makes conflicting edit v3
      this.interceptor.setStep(faultStep);
      this.interceptor.armFault(fault, faultStep);

      let told: ToldState = { status: 'error_thrown', cloudSynced: false };
      try {
        const saveRes = await StorageService.saveVersion(this.userId, localDocId, {
          title: 'Divergent Note',
          content: 'Device A edit v3 conflicting',
          wordCount: 5,
          duration: 40,
          wpm: 12,
          tags: [],
          sessionStartedAt: new Date(3000),
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

      // P1: Every version that existed on the device before conflict resolution
      // must exist readable in the union of original ∪ fork!
      const db = await getLocalDb();
      const allLocalVersions = await db.getAll('versions');
      const allLocalContents = new Set(allLocalVersions.map(v => v.content));
      const requiredTexts = ['Base v1 text', 'Device A own v2 text', 'Device A edit v3 conflicting'];
      const p1Held = requiredTexts.every(t => allLocalContents.has(t));
      if (!p1Held) {
        notes.push('P1 VIOLATION (CHOKE-1): pre-conflict local version lost during conflict resolution');
      }

      const p2Held = this.evaluateP2(
        ['Divergent Note', 'Base v1 text', 'Device A own v2 text', 'Device B edit v3', 'Device A edit v3 conflicting'],
        (postgres.documentExists && !postgres.deletedAt) || postgres.versionsCount > 0,
        notes
      );
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
        faultFired: this.interceptor.getFaultFiredCount(),
      };
    }

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
    const db = await getLocalDb();
    const allLocalVersions = await db.getAll('versions');
    const allLocalContents = new Set(allLocalVersions.map(v => v.content));
    const p1Held = told.forked === true
      ? (allLocalContents.has('Base v1 text') && allLocalContents.has('Device A edit v2 conflicting'))
      : Boolean(device.latestContent?.includes('Device A edit v2'));
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
      faultFired: this.interceptor.getFaultFiredCount(),
    };
  }

  // =========================================================================
  // SEQUENCE 4: write → save → sync → delete
  // =========================================================================
  public async runSeq4_WriteSaveSyncDelete(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    this.interceptor.resetFaultFired();
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

    // Neighbor note (DC-1) to verify deletion is targeted and does not corrupt adjacent notes
    const neighborText = 'Neighbor Note Text';
    const neighborId = await LocalStorageService.createDocument(this.userId, {
      title: 'Neighbor Note',
      tags: [],
      firstSessionAt: 1000,
      lastSessionAt: 1000,
    });
    await StorageService.saveVersion(this.userId, neighborId, {
      title: 'Neighbor Note',
      content: neighborText,
      wordCount: 3,
      duration: 30,
      wpm: 12,
      tags: [],
      sessionStartedAt: new Date(1000),
    });
    const neighborCloudId = await StorageService.addCloudCopy(this.userId, neighborId);

    const markers = ['To Delete', 'Text to delete'];
    const p2Before = this.evaluateP2(markers, true, notes);

    this.interceptor.setStep(faultStep);
    this.interceptor.armFault(fault, faultStep);

    let told: ToldState = { status: 'deleted', cloudSynced: false };
    try {
      const delRes = await StorageService.deleteDocument(this.userId, localDocId, cloudId);
      told = {
        status: delRes.cloudSynced ? 'deleted' : 'deleted_local_queued',
        cloudSynced: delRes.cloudSynced,
      };
    } catch (e: unknown) {
      told = { status: 'error_thrown', cloudSynced: false, error: (e as Error).message };
      notes.push(`Error during deleteDocument: ${(e as Error).message}`);
    }

    const device = await this.inspectDevice(localDocId, cloudId);
    const postgres = this.inspectPostgres(cloudId);
    const neighborDevice = await this.inspectDevice(neighborId, neighborCloudId);
    const neighborPostgres = this.inspectPostgres(neighborCloudId);

    if (faultStep === 'delete_cloud' && (fault === 'network_pre' || fault === 'postgres_500')) {
      if (!postgres.deletedAt && postgres.documentExists) {
        notes.push('Discrepancy: Local document deleted immediately, but cloud row remains active until queue drain');
      }
    }

    const vaultOn = getEncryptionEnabled(this.userId);
    const leaksAfter = this.interceptor.postgres.plaintextLeaks(markers);
    if (vaultOn && leaksAfter.length > 0) {
      notes.push('P2 LEAK: marker found after deletion in ' + leaksAfter.join(', '));
    }

    const leftoverTables: string[] = [];
    if (told.status === 'deleted') {
      const versions = this.interceptor.postgres.getRows('versions').filter(r => r.document_uuid === cloudId);
      if (versions.length > 0) leftoverTables.push('versions');
      const summaries = this.interceptor.postgres.getRows('ai_summaries').filter(r => r.document_id === cloudId);
      if (summaries.length > 0) leftoverTables.push('ai_summaries');
      const embeddings = this.interceptor.postgres.getRows('ai_embeddings').filter(r => r.document_id === cloudId);
      if (embeddings.length > 0) leftoverTables.push('ai_embeddings');
      const docs = this.interceptor.postgres.getRows('documents').filter(r => r.uuid === cloudId && !r.deleted_at);
      if (docs.length > 0) leftoverTables.push('documents');
    }
    if (leftoverTables.length > 0) {
      notes.push('P2 VIOLATION: leftover rows found in ' + leftoverTables.join(', '));
    }

    // DC-1: P1 measurement for deletion
    const neighborIntactLocal = neighborDevice.documentExists && neighborDevice.latestContent === neighborText;
    const neighborIntactCloud = neighborPostgres.documentExists && !neighborPostgres.deletedAt;
    let targetCorrectLocal: boolean;
    if (told.status === 'error_thrown') {
      targetCorrectLocal = device.documentExists && device.latestContent === 'Text to delete';
    } else {
      targetCorrectLocal = !device.documentExists;
    }
    const p1Held = neighborIntactLocal && neighborIntactCloud && targetCorrectLocal;

    let p2Held: boolean | undefined;
    if (vaultOn) {
      if (p2Before === false || leaksAfter.length > 0 || leftoverTables.length > 0) {
        p2Held = false;
      } else if (p2Before === true) {
        p2Held = true;
      } else {
        p2Held = undefined;
      }
    } else {
      if (leftoverTables.length > 0) {
        p2Held = false;
      } else {
        p2Held = undefined;
      }
    }
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
      faultFired: this.interceptor.getFaultFiredCount(),
    };
  }

  // =========================================================================
  // SEQUENCE 5: write → save → delete before it ever synced
  // =========================================================================
  public async runSeq5_DeleteBeforeSync(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    this.interceptor.resetFaultFired();
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

    // Neighbor note (DC-1) to verify deletion is targeted
    const neighborText = 'Neighbor Offline Text';
    const neighborId = await LocalStorageService.createDocument(this.userId, {
      title: 'Neighbor Note',
      tags: [],
      firstSessionAt: 1000,
      lastSessionAt: 1000,
    });
    await StorageService.saveVersion(this.userId, neighborId, {
      title: 'Neighbor Note',
      content: neighborText,
      wordCount: 3,
      duration: 30,
      wpm: 12,
      tags: [],
      sessionStartedAt: new Date(1000),
    });

    const markers = ['Offline Note', 'Unsynced text'];
    const leaksBefore = this.interceptor.postgres.plaintextLeaks(markers);

    // Enqueue a sync task as normally happens
    await SyncService.addToQueue(localDocId);

    // Now delete locally
    this.interceptor.setStep(faultStep);
    this.interceptor.armFault(fault, faultStep);

    let told: ToldState = { status: 'deleted', cloudSynced: true };
    try {
      const delRes = await StorageService.deleteDocument(this.userId, localDocId, undefined);
      told = {
        status: delRes.cloudSynced ? 'deleted' : 'deleted_local_queued',
        cloudSynced: delRes.cloudSynced,
      };
    } catch (e: unknown) {
      told = { status: 'error_thrown', cloudSynced: false, error: (e as Error).message };
      notes.push(`Error during deleteDocument: ${(e as Error).message}`);
    }

    // DC-2: drain the queue as app does after deletion
    this.interceptor.clearArmedFault();
    await SyncService.syncPending(this.userId, { force: true });

    const device = await this.inspectDevice(localDocId);
    const postgres = this.inspectPostgres(localDocId);
    const neighborDevice = await this.inspectDevice(neighborId);

    // Defect check: did the syncQueue retain the upload task for the deleted document?
    const hasOrphanTask = device.queueTasks.some(t => t.documentId === localDocId || (t.type === 'document' && t.documentId === localDocId));
    if (hasOrphanTask) {
      notes.push('DEFECT: Deleting unlinked local note leaves orphaned task in syncQueue that fails on drain');
    }

    // DC-1: P1 measurement for deletion before sync
    const neighborIntactLocal = neighborDevice.documentExists && neighborDevice.latestContent === neighborText;
    let targetCorrectLocal: boolean;
    if (told.status === 'error_thrown') {
      targetCorrectLocal = device.documentExists && device.latestContent === 'Unsynced text';
    } else {
      targetCorrectLocal = !device.documentExists;
    }
    const p1Held = neighborIntactLocal && targetCorrectLocal;

    // DC-2: P2 measurement — note deleted before sync must never reach cloud
    const vaultOn = getEncryptionEnabled(this.userId);
    const leaksAfter = this.interceptor.postgres.plaintextLeaks(markers);
    const anyCloudRows = this.interceptor.postgres.getRows('documents').length > 0 || this.interceptor.postgres.getRows('versions').length > 0;
    if (leaksBefore.length > 0 || leaksAfter.length > 0 || anyCloudRows) {
      notes.push('P2 VIOLATION: offline note leaked to cloud');
    }

    let p2Held: boolean | undefined;
    if (vaultOn) {
      p2Held = (leaksBefore.length === 0 && leaksAfter.length === 0 && !anyCloudRows && !hasOrphanTask);
    } else {
      p2Held = undefined;
    }
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
      faultFired: this.interceptor.getFaultFiredCount(),
      defectFound: hasOrphanTask ? 'SYNC-DEFECT: orphan syncQueue task after local note deletion' : undefined,
    };
  }

  // =========================================================================
  // SEQUENCE 6: write → save → sync → delete on B → edit on A → sync
  // =========================================================================
  public async runSeq6_TombstoneEditRecovery(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    this.interceptor.resetFaultFired();
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
    const p1Held = device.documentExists &&
      Boolean(device.latestContent?.includes('offline edits')) &&
      (device.unlinkedByTombstone === true || device.queueTasks.length > 0);
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
      faultFired: this.interceptor.getFaultFiredCount(),
    };
  }

  // =========================================================================
  // SEQUENCE 7: sign out with erasure → sign in → restore
  // =========================================================================
  public async runSeq7_SignOutEraseRestore(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    this.interceptor.resetFaultFired();
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
      if (this.vaultEnabled && !getSessionKey()) {
        told = { status: 'error_thrown', cloudSynced: false, error: 'Vault is locked' };
        notes.push('Restore skipped: vault is locked');
      } else {
        const res = await CloudSyncService.restoreMissingDocuments(this.userId, { force: true });
        told = { status: 'restored', cloudSynced: true, userFacingMessage: `Restored ${res.restored}` };
      }
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
      faultFired: this.interceptor.getFaultFiredCount(),
    };
  }

  // =========================================================================
  // SEQUENCE 8: guest writes → signs up → migration → sync
  // =========================================================================
  public async runSeq8_GuestSignupMigrateSync(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    this.interceptor.resetFaultFired();
    const notes: string[] = [];
    this.setCurrentUser(null);
    localStorage.setItem('jw_guest_id', this.guestId);

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
    this.setCurrentUser({
      uid: this.userId,
      email: 'test@example.com',
      displayName: 'Test User',
      photoURL: null,
      metadata: { creationTime: null, lastSignInTime: null },
    });
    const { migrateDocuments } = await import('../../features/auth/services/migrateDocuments');
    this.interceptor.setStep(faultStep);
    this.interceptor.armFault(fault, faultStep);

    let told: ToldState = { status: 'migrated', cloudSynced: false };
    try {
      const { moved } = await migrateDocuments(this.userId);
      told = { status: 'migrated', cloudSynced: false, userFacingMessage: `Migrated ${moved} docs` };
      // Sync migrated document
      try {
        const cloudId = await StorageService.addCloudCopy(this.userId, guestDocId);
        if (cloudId) told.cloudSynced = true;
      } catch (syncErr: unknown) {
        notes.push(`Initial sync failed during fault: ${(syncErr as Error).message}`);
      }
    } catch (e: unknown) {
      told = { status: 'error_thrown', cloudSynced: false, error: (e as Error).message };
      notes.push(`Error during migrateDocuments: ${(e as Error).message}`);
    }

    // DC-4: сеть вернулась. Приложение дочищает перенос так же, как любую
    // заметку без облачной копии: фоновый проход (useBackgroundSync) находит её
    // обходом sweepOrphanedDocuments и прогоняет очередь. Здесь — те же два
    // вызова, а не отдельная постановка в очередь при переносе.
    this.interceptor.clearArmedFault();
    // Обход берёт заметки старше 5 минут — ноль здесь значит «следующий проход,
    // пять минут спустя».
    await SyncService.sweepOrphanedDocuments(this.userId, 0);
    await SyncService.syncPending(this.userId);

    const device = await this.inspectDevice(guestDocId);
    const postgres = this.inspectPostgres(device.linkedCloudId || guestDocId);

    const cloudExists = (postgres.documentExists && !postgres.deletedAt) && postgres.versionsCount >= 1;

    const p1Held = Boolean(device.latestContent === 'Guest text content' && device.documentExists);
    let p2Held: boolean | undefined;
    const vaultOn = getEncryptionEnabled(this.userId);
    if (vaultOn) {
      if (!cloudExists) {
        notes.push('P2 VIOLATION: note expected in cloud after migration queue drain, but missing in cloud');
        p2Held = false;
      } else {
        const evalRes = this.evaluateP2(['Guest Note', 'Guest text content'], true, notes);
        p2Held = evalRes === true ? true : false;
      }
    } else {
      p2Held = this.evaluateP2(['Guest Note', 'Guest text content'], cloudExists, notes);
    }
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
      faultFired: this.interceptor.getFaultFiredCount(),
    };
  }

  // =========================================================================
  // SEQUENCE 9: enable encryption on existing archive → sync → restore
  // =========================================================================
  public async runSeq9_EnableEncryptionSyncRestore(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    this.interceptor.resetFaultFired();
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
      first_session_at: new Date(1000).toISOString(),
      last_session_at: new Date(1000).toISOString(),
      _encrypted: false,
    });
    this.interceptor.postgres.executeInsert('versions', {
      document_uuid: cloudId,
      user_id: this.userId,
      version: 1,
      content: 'Plaintext secret note content',
      word_count: 4,
      duration: 30,
      saved_at: new Date(1000).toISOString(),
      session_started_at: new Date(1000).toISOString(),
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

    if (told.status !== 'error_thrown') {
      try {
        await CloudSyncService.restoreMissingDocuments(this.userId, { force: true }); // намеренно: в симуляции проверяется состояние БД, а не число восстановленных
      } catch (e: unknown) {
        notes.push(`Error during restoreMissingDocuments: ${(e as Error).message}`);
      }
    }

    const device = await this.inspectDevice(cloudId);
    const postgres = this.inspectPostgres(cloudId);
    const summaryRows = this.interceptor.postgres.getRows('ai_summaries');
    const summary = summaryRows.find(s => s.document_id === cloudId);

    const p1Held = told.status === 'error_thrown'
      ? true
      : Boolean(device.documentExists && device.latestContent === 'Plaintext secret note content');

    // P2 Evaluation:
    // If migration failed with error, it didn't complete so P2 is not measured
    const p2Held = told.status === 'error_thrown'
      ? undefined
      : this.evaluateP2(
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
      faultFired: this.interceptor.getFaultFiredCount(),
      defectFound: p2Held === false ? 'P2-DEFECT: unencrypted AI derivatives remain plaintext after vault setup' : undefined,
    };
  }

  // =========================================================================
  // SEQUENCE 10: delete account
  // =========================================================================
  public async runSeq10_DeleteAccount(fault: FaultType, faultStep: StepName): Promise<MatrixCellResult> {
    await this.setup();
    this.interceptor.resetFaultFired();
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
    // Строка профиля есть у каждого аккаунта — без неё проверка users (N-46) была бы пустой.
    this.interceptor.postgres.executeInsert('users', { uid: this.userId, email: 'test@example.com' });

    const markers = ['Delete Account Note', 'Text to be deleted with account'];
    const p2Before = this.evaluateP2(markers, true, notes);

    // Mock deleteAccount server call
    this.interceptor.setStep(faultStep);
    this.interceptor.armFault(fault, faultStep);

    let told: ToldState = { status: 'deleted', cloudSynced: true };
    try {
      // TB-08 Part A: Call real AuthService.deleteAccount(password).
      // Note: reauthenticate and callAi('deleteAccount') are intercepted by the harness.
      // Server-side cascade in Postgres is modeled in InMemoryPostgres (Part A);
      // real Postgres deletion is tested in api/__tests__/deleteAccount.db.test.ts (Part B).
      const { AuthService } = await import('../../features/auth/services/AuthService');
      await AuthService.deleteAccount('test-password');
    } catch (e: unknown) {
      told = { status: 'error_thrown', cloudSynced: false, error: (e as Error).message };
      notes.push(`Error during deleteAccount: ${(e as Error).message}`);
    }

    const device = await this.inspectDevice(docId);
    const postgres = this.inspectPostgres(cloudId);

    const vaultOn = getEncryptionEnabled(this.userId);
    const leaksAfter = this.interceptor.postgres.plaintextLeaks(markers);
    if (vaultOn && leaksAfter.length > 0) {
      notes.push('P2 LEAK: marker found after account deletion in ' + leaksAfter.join(', '));
    }

    const leftoverTables: string[] = [];
    if (told.status === 'deleted') {
      // Тот же список, что у чистки фейкового сервера, плюс users по uid (N-46):
      // таблица, добавленная в одну половину, не выпадает из другой.
      for (const t of this.interceptor.postgres.getTableNamesWithColumn('user_id')) {
        const rows = this.interceptor.postgres.getRows(t).filter(r => r.user_id === this.userId);
        if (rows.length > 0) leftoverTables.push(t);
      }
      if (this.interceptor.postgres.getRows('users').some(r => r.uid === this.userId)) leftoverTables.push('users');
    }
    if (leftoverTables.length > 0) {
      notes.push('P2 VIOLATION: leftover user rows found in ' + leftoverTables.join(', '));
    }

    // Next-steps №8: P1 here was always «not measured», so P4 never could be.
    // - Deletion failed: nothing may be lost — the note is still on the device
    //   with its text, and the cloud copy is untouched.
    // - Deletion succeeded: the person asked for exactly this loss. P1 holds iff
    //   the loss is complete and nothing else was lost: the device keeps none of
    //   this account's notes (a half-erased device is the failure here).
    let p1Held: boolean | undefined;
    if (told.status === 'deleted') {
      const db = await getLocalDb();
      const leftLocal = (await db.getAll('documents')).filter(d => d.guestId === this.userId).length
        + (await db.getAll('versions')).filter(v => v.guestId === this.userId).length;
      if (leftLocal > 0) notes.push(`P1/P4: ${leftLocal} local rows of the deleted account left on the device`);
      p1Held = leftLocal === 0;
    } else {
      p1Held = device.documentExists && device.latestContent === 'Text to be deleted with account' && postgres.documentExists;
      if (!p1Held) notes.push('P1 VIOLATION: a failed account deletion lost the local note or its cloud copy');
    }
    let p2Held: boolean | undefined;
    if (vaultOn) {
      if (p2Before === false || leaksAfter.length > 0 || leftoverTables.length > 0) {
        p2Held = false;
      } else if (p2Before === true) {
        p2Held = true;
      } else {
        p2Held = undefined;
      }
    } else {
      if (leftoverTables.length > 0) {
        p2Held = false;
      } else {
        p2Held = undefined;
      }
    }
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
      faultFired: this.interceptor.getFaultFiredCount(),
    };
  }
}
