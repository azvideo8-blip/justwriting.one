/**
 * Matrix Runner
 *
 * Runs the full sequence × fault × step matrix, evaluating:
 * 1. What the person was told
 * 2. What is on the device
 * 3. What is in Postgres
 *
 * Checks Postulates P1, P2, P3, P4 for every cell and reports disagreements.
 */

import { LifecycleRunner } from './lifecycleRunner';
import { FaultType, StepName, MatrixCellResult, LifecycleSequence } from './faultTypes';

export interface MatrixRunConfig {
  sequences: LifecycleSequence[];
  faults: FaultType[];
}

export class MatrixRunner {
  private runner: LifecycleRunner;

  constructor(runner?: LifecycleRunner) {
    this.runner = runner || new LifecycleRunner();
  }

  public async runCell(
    sequence: LifecycleSequence,
    fault: FaultType,
    step: StepName,
    vaultEnabled?: boolean
  ): Promise<MatrixCellResult> {
    if (vaultEnabled !== undefined) {
      this.runner.vaultEnabled = vaultEnabled;
    }
    let res: MatrixCellResult;
    switch (sequence) {
      case 'seq1_write_save_sync':
        res = await this.runner.runSeq1_WriteSaveSync(fault, step);
        break;
      case 'seq2_write_save_edit_save_sync':
        res = await this.runner.runSeq2_WriteSaveEditSaveSync(fault, step);
        break;
      case 'seq3_cross_device_divergence':
        res = await this.runner.runSeq3_CrossDeviceDivergence(fault, step);
        break;
      case 'seq4_write_save_sync_delete':
        res = await this.runner.runSeq4_WriteSaveSyncDelete(fault, step);
        break;
      case 'seq5_delete_before_sync':
        res = await this.runner.runSeq5_DeleteBeforeSync(fault, step);
        break;
      case 'seq6_tombstone_edit_recovery':
        res = await this.runner.runSeq6_TombstoneEditRecovery(fault, step);
        break;
      case 'seq7_sign_out_erase_restore':
        res = await this.runner.runSeq7_SignOutEraseRestore(fault, step);
        break;
      case 'seq8_guest_signup_migrate_sync':
        res = await this.runner.runSeq8_GuestSignupMigrateSync(fault, step);
        break;
      case 'seq9_enable_encryption_sync_restore':
        res = await this.runner.runSeq9_EnableEncryptionSyncRestore(fault, step);
        break;
      case 'seq10_delete_account':
        res = await this.runner.runSeq10_DeleteAccount(fault, step);
        break;
    }
    res.vaultEnabled = vaultEnabled ?? this.runner.vaultEnabled;
    return res;
  }

  public async runFullMatrix(): Promise<MatrixCellResult[]> {
    const results: MatrixCellResult[] = [];

    // The 10 sequences mapped to their primary failure-injection steps
    const scenarios: { seq: LifecycleSequence; fault: FaultType; step: StepName }[] = [
      // Sequence 1: write → save → sync
      { seq: 'seq1_write_save_sync', fault: 'none', step: 'sync_cloud' },
      { seq: 'seq1_write_save_sync', fault: 'network_pre', step: 'sync_cloud' },
      { seq: 'seq1_write_save_sync', fault: 'network_post', step: 'sync_cloud' },
      { seq: 'seq1_write_save_sync', fault: 'postgres_500', step: 'sync_cloud' },
      { seq: 'seq1_write_save_sync', fault: 'postgres_409', step: 'sync_cloud' },
      { seq: 'seq1_write_save_sync', fault: 'postgres_429', step: 'sync_cloud' },
      { seq: 'seq1_write_save_sync', fault: 'idb_quota', step: 'save_local' },
      { seq: 'seq1_write_save_sync', fault: 'abort', step: 'sync_cloud' },

      // Sequence 2: write → save → edit → save → sync
      { seq: 'seq2_write_save_edit_save_sync', fault: 'none', step: 'sync_second' },
      { seq: 'seq2_write_save_edit_save_sync', fault: 'network_pre', step: 'sync_second' },
      { seq: 'seq2_write_save_edit_save_sync', fault: 'network_post', step: 'sync_second' },
      { seq: 'seq2_write_save_edit_save_sync', fault: 'postgres_500', step: 'sync_second' },
      { seq: 'seq2_write_save_edit_save_sync', fault: 'postgres_429', step: 'sync_second' },
      { seq: 'seq2_write_save_edit_save_sync', fault: 'abort', step: 'sync_second' },

      // Sequence 3: cross-device divergence
      { seq: 'seq3_cross_device_divergence', fault: 'none', step: 'device_b_edit' },
      { seq: 'seq3_cross_device_divergence', fault: 'network_pre', step: 'sync_cloud' },
      { seq: 'seq3_cross_device_divergence', fault: 'postgres_500', step: 'sync_cloud' },

      // Sequence 4: write → save → sync → delete
      { seq: 'seq4_write_save_sync_delete', fault: 'none', step: 'delete_local' },
      { seq: 'seq4_write_save_sync_delete', fault: 'network_pre', step: 'delete_cloud' },
      { seq: 'seq4_write_save_sync_delete', fault: 'postgres_500', step: 'delete_cloud' },
      { seq: 'seq4_write_save_sync_delete', fault: 'abort', step: 'delete_local' },

      // Sequence 5: write → save → delete before sync
      { seq: 'seq5_delete_before_sync', fault: 'none', step: 'delete_local' },
      { seq: 'seq5_delete_before_sync', fault: 'abort', step: 'delete_local' },

      // Sequence 6: tombstone recovery
      { seq: 'seq6_tombstone_edit_recovery', fault: 'none', step: 'edit_local' },
      { seq: 'seq6_tombstone_edit_recovery', fault: 'network_pre', step: 'edit_local' },

      // Sequence 7: sign out erase restore
      { seq: 'seq7_sign_out_erase_restore', fault: 'none', step: 'restore' },
      { seq: 'seq7_sign_out_erase_restore', fault: 'network_pre', step: 'restore' },
      { seq: 'seq7_sign_out_erase_restore', fault: 'vault_locked', step: 'restore' },

      // Sequence 8: guest migrate sync
      { seq: 'seq8_guest_signup_migrate_sync', fault: 'none', step: 'migrate' },
      { seq: 'seq8_guest_signup_migrate_sync', fault: 'network_pre', step: 'sync_cloud' },

      // Sequence 9: enable encryption sync restore
      { seq: 'seq9_enable_encryption_sync_restore', fault: 'none', step: 'enable_encryption' },
      { seq: 'seq9_enable_encryption_sync_restore', fault: 'network_pre', step: 'enable_encryption' },
      { seq: 'seq9_enable_encryption_sync_restore', fault: 'vault_locked', step: 'enable_encryption' },

      // Sequence 10: delete account
      { seq: 'seq10_delete_account', fault: 'none', step: 'delete_account' },
      { seq: 'seq10_delete_account', fault: 'network_pre', step: 'delete_account' },
    ];

    for (const item of scenarios) {
      const vaultOptions = item.seq === 'seq9_enable_encryption_sync_restore'
        ? [false]
        : [false, true];

      for (const vault of vaultOptions) {
        try {
          const res = await this.runCell(item.seq, item.fault, item.step, vault);
          results.push(res);
        } catch (err: unknown) {
          results.push({
            sequence: item.seq,
            fault: item.fault,
            step: item.step,
            vaultEnabled: vault,
            told: { status: 'error_thrown', cloudSynced: false, error: (err as Error).message },
            device: { documentExists: false, versionsCount: 0, queueTasks: [] },
            postgres: { documentExists: false, versionsCount: 0 },
            p1Held: true,
            p2Held: undefined,
            p3Held: false,
            p4Held: false,
            notes: [`Unhandled error during runCell: ${(err as Error).message}`],
          });
        }
      }
    }

    return results;
  }
}
