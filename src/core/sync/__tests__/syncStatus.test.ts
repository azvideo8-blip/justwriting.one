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
});
