import { describe, it, expect } from 'vitest';
import { documentFromDb } from '../mappers';
import { DocumentDb } from '../../data/schemas';
import type { DocumentFields } from '../../../shared/types/common';

// AUDIT-part2 4.2 / 10.2: контракт маппера. Канонические поля документа
// обязаны доходить из БД в облачную форму без потерь. Дрейф схемы («поле есть
// в базе, забыто в маппере») ловится этим тестом, а не архивом пользователя.

const CANONICAL_FIELDS = Object.keys({
  title: 1, currentVersion: 1, totalWords: 1, totalDuration: 1,
  sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1,
  isPublic: 1, tags: 1, labelId: 1, mood: 1, excludedFromAI: 1,
} satisfies Record<keyof DocumentFields<unknown>, unknown>);

function fullDbDoc(): DocumentDb {
  // Все канонические поля заполнены различными значениями.
  return {
    id: 'doc_1',
    uuid: 'uuid_1',
    userId: 'user_1',
    title: 'Synthetic contract title',
    currentVersion: 7,
    totalWords: 1234,
    totalDuration: 567,
    sessionsCount: 9,
    firstSessionAt: new Date('2026-08-24T10:00:00Z'),
    lastSessionAt: new Date('2026-08-24T11:00:00Z'),
    isPublic: false,
    tags: ['synthetic'],
    labelId: 'label_1',
    mood: 'calm',
    excludedFromAI: true,
  } as unknown as DocumentDb;
}

describe('documentFromDb mapper contract (AUDIT-10.2)', () => {
  it('carries every canonical DocumentFields property into the cloud shape', () => {
    const doc = documentFromDb(fullDbDoc()) as unknown as Record<string, unknown>;
    for (const field of CANONICAL_FIELDS) {
      expect(doc[field], `canonical field "${field}" lost by documentFromDb`).toBeDefined();
    }
  });

  it('preserves canonical values verbatim', () => {
    const doc = documentFromDb(fullDbDoc());
    expect(doc.title).toBe('Synthetic contract title');
    expect(doc.currentVersion).toBe(7);
    expect(doc.totalWords).toBe(1234);
    expect(doc.sessionsCount).toBe(9);
    expect(doc.tags).toEqual(['synthetic']);
    expect(doc.labelId).toBe('label_1');
    expect(doc.mood).toBe('calm');
    expect(doc.excludedFromAI).toBe(true);
  });

  it('converts timestamps to Date on the cloud side', () => {
    const doc = documentFromDb(fullDbDoc());
    expect(doc.firstSessionAt).toBeInstanceOf(Date);
    expect(doc.lastSessionAt).toBeInstanceOf(Date);
  });
});
