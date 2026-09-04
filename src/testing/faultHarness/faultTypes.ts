/**
 * Types and interfaces for the Fault-Injection Harness
 */

export type FaultType =
  | 'none'
  | 'abort'
  | 'network_pre'
  | 'network_mid'
  | 'network_post' // Phantom write: cloud write succeeds, but response drops
  | 'postgres_500'
  | 'postgres_409'
  | 'postgres_429'
  | 'idb_quota'
  | 'idb_tx_autoclose'
  | 'vault_locked'
  | 'decrypt_corrupt_single'
  | 'clock_backwards'
  | 'concurrent_tab';

export type LifecycleSequence =
  | 'seq1_write_save_sync'
  | 'seq2_write_save_edit_save_sync'
  | 'seq3_cross_device_divergence'
  | 'seq4_write_save_sync_delete'
  | 'seq5_delete_before_sync'
  | 'seq6_tombstone_edit_recovery'
  | 'seq7_sign_out_erase_restore'
  | 'seq8_guest_signup_migrate_sync'
  | 'seq9_enable_encryption_sync_restore'
  | 'seq10_delete_account';

export type StepName =
  | 'initial_write'
  | 'save_local'
  | 'sync_cloud'
  | 'edit_local'
  | 'save_second'
  | 'sync_second'
  | 'device_b_edit'
  | 'device_b_delete'
  | 'delete_local'
  | 'delete_cloud'
  | 'sign_out_erase'
  | 'sign_in'
  | 'restore'
  | 'guest_write'
  | 'migrate'
  | 'enable_encryption'
  | 'delete_account';

export interface ToldState {
  status:
    | 'synced_to_cloud'
    | 'saved_local_queued'
    | 'forked_conflict'
    | 'deleted'
    | 'restored'
    | 'migrated'
    | 'error_thrown';
  cloudSynced: boolean;
  forked?: boolean | undefined;
  forkTitle?: string | undefined;
  error?: string | undefined;
  userFacingMessage?: string | undefined;
}

export interface DeviceState {
  documentExists: boolean;
  currentVersion?: number | undefined;
  versionsCount: number;
  latestContent?: string | undefined;
  linkedCloudId?: string | undefined;
  localOnly?: boolean | undefined;
  unlinkedByTombstone?: boolean | undefined;
  queueTasks: {
    id: string;
    documentId: string;
    type: string;
    attempts?: number | undefined;
    dead?: boolean | undefined;
    lastError?: string | undefined;
  }[];
}

export interface PostgresState {
  documentExists: boolean;
  currentVersion?: number | undefined;
  versionsCount: number;
  latestContent?: string | undefined;
  isEncrypted?: boolean | undefined;
  deletedAt?: string | null | undefined;
  rawRows?: Record<string, unknown>[] | undefined;
}

export interface MatrixCellResult {
  sequence: LifecycleSequence;
  fault: FaultType;
  step: StepName;
  vaultEnabled?: boolean | undefined;
  told: ToldState;
  device: DeviceState;
  postgres: PostgresState;
  p1Held: boolean;
  p2Held: boolean | undefined;
  p3Held: boolean;
  p4Held: boolean | undefined;
  notes: string[];
  defectFound?: string | undefined;
}
