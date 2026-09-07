import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllLocalStores } from '../../storage/localDb';
import { LocalVersionService } from '../LocalVersionService';

describe('E-7: LocalVersionService.getAllDocumentSittings', () => {
  beforeEach(async () => {
    await clearAllLocalStores();
  });

  it('batch-reads sittings for all documents grouped by documentId', async () => {
    const d1 = new Date(2026, 8, 1, 10, 0);
    const d2 = new Date(2026, 8, 2, 10, 0);
    const d3 = new Date(2026, 8, 3, 10, 0);

    await LocalVersionService.addVersion('guest', 'doc_a', {
      content: 'hello',
      previousContent: '',
      wordCount: 1,
      duration: 30,
      wpm: 2,
      versionNumber: 1,
      sessionStartedAt: d1,
      savedAt: d1,
    });

    await LocalVersionService.addVersion('guest', 'doc_a', {
      content: 'hello world',
      previousContent: 'hello',
      wordCount: 2,
      duration: 60,
      wpm: 2,
      versionNumber: 2,
      sessionStartedAt: d2,
      savedAt: d2,
    });

    await LocalVersionService.addVersion('guest', 'doc_b', {
      content: 'testing',
      previousContent: '',
      wordCount: 1,
      duration: 15,
      wpm: 4,
      versionNumber: 1,
      sessionStartedAt: d3,
      savedAt: d3,
    });

    const sittingsMap = await LocalVersionService.getAllDocumentSittings();
    expect(sittingsMap.size).toBe(2);

    const docASittings = sittingsMap.get('doc_a');
    expect(docASittings).toBeDefined();
    expect(docASittings?.length).toBe(2);
    expect(docASittings?.[0]?.version).toBe(1);
    expect(docASittings?.[1]?.version).toBe(2);

    const docBSittings = sittingsMap.get('doc_b');
    expect(docBSittings).toBeDefined();
    expect(docBSittings?.length).toBe(1);
    expect(docBSittings?.[0]?.version).toBe(1);
    expect(docBSittings?.[0]?.documentId).toBe('doc_b');

    expect(sittingsMap.get('non_existent')).toBeUndefined();
  });
});
