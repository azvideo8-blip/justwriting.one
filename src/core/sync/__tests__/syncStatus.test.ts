import { describe, it, expect } from 'vitest';
import { syncStatusOf, type SyncStatus } from '../syncStatus';
import type { LocalDocument } from '../../storage/localDb';

// AUDIT-part2 5.1: единственная точка интерпретации флагов документа.
function doc(partial: Partial<LocalDocument>): LocalDocument {
  return {
    id: 'doc_1', guestId: 'guest_1', title: '', currentVersion: 0,
    totalWords: 0, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: 0, lastSessionAt: 0, tags: [],
    ...partial,
  } as LocalDocument;
}

describe('syncStatusOf (AUDIT-part2 5.1)', () => {
  const expectations: Array<[Partial<LocalDocument>, SyncStatus]> = [
    [{ linkedCloudId: 'cloud_1' }, 'linked'],
    [{}, 'unlinked-new'],
    [{ linkedCloudId: '' }, 'unlinked-new'],
    [{ localOnly: true }, 'local-only'],
    [{ linkedCloudId: 'cloud_1', localOnly: true }, 'local-only'],
    [{ _locked: true, linkedCloudId: 'cloud_1' }, 'locked'],
    [{ _decryptionError: true, linkedCloudId: 'cloud_1' }, 'unreadable'],
    // Порядок значим: нерасшифровываемый документ не «unlinked-new», даже
    // если ссылка потеряна — иначе sync зальёт шифротекст как новую заметку.
    [{ _decryptionError: true }, 'unreadable'],
    [{ _locked: true }, 'locked'],
  ];

  it.each(expectations)('maps %j -> %s', (partial, expected) => {
    expect(syncStatusOf(doc(partial))).toBe(expected);
  });

  it('unreadable/locked win over unlinked-new (no ciphertext uploads)', () => {
    const statuses = [doc({ _decryptionError: true }), doc({ _locked: true })].map(syncStatusOf);
    expect(statuses).not.toContain('unlinked-new');
  });

  it('CHOKE-5: syncStatusOf and upload eligibility match across all 16 flag permutations', () => {
    const bools = [false, true];
    for (const localOnly of bools) {
      for (const hasLinkedCloudId of bools) {
        for (const _locked of bools) {
          for (const _decryptionError of bools) {
            const d = doc({
              localOnly,
              linkedCloudId: hasLinkedCloudId ? 'cloud-123' : undefined,
              _locked,
              _decryptionError,
              currentVersion: 2,
              lastSyncedCloudVersion: 1,
            });

            // Direct flag interpretation (legacy SyncService filter)
            const directEligible = (() => {
              if (d.localOnly || d._locked || d._decryptionError) return false;
              if (!d.linkedCloudId) return true;
              return (d.currentVersion ?? 0) > (d.lastSyncedCloudVersion ?? 0);
            })();

            // syncStatusOf interpretation (updated SyncService filter)
            const status = syncStatusOf(d);
            const statusEligible = (() => {
              if (status === 'local-only' || status === 'locked' || status === 'unreadable') return false;
              if (status === 'unlinked-new') return true;
              return (d.currentVersion ?? 0) > (d.lastSyncedCloudVersion ?? 0);
            })();

            expect(
              statusEligible,
              `Mismatch for flags: localOnly=${localOnly}, linkedCloudId=${hasLinkedCloudId}, _locked=${_locked}, _decryptionError=${_decryptionError} (status=${status})`
            ).toBe(directEligible);
          }
        }
      }
    }
  });
});
