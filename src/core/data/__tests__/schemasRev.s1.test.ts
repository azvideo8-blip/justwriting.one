import { describe, it, expect } from 'vitest';
import { documentDbSchema, versionDbSchema } from '../schemas';

/**
 * S1-8: старая версия приложения читает `select('*')` и получает новую
 * открытую колонку `rev` (0045). Разбор не должен ни падать, ни протаскивать
 * её внутрь: это серверный номер строки, а не поле заметки.
 */
describe('rev tolerated by old-client row schemas (S1-8)', () => {
  it('documentDbSchema accepts and strips an extra rev', () => {
    const parsed = documentDbSchema.safeParse({
      id: 's1-rev-doc',
      uuid: 's1-rev-doc',
      title: 'Note',
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      rev: 42,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect('rev' in parsed.data).toBe(false);
    expect(parsed.data.id).toBe('s1-rev-doc');
  });

  it('versionDbSchema accepts and strips an extra rev', () => {
    const parsed = versionDbSchema.safeParse({
      id: 'v1',
      documentId: 's1-rev-doc',
      version: 1,
      content: 'text',
      savedAt: 1000,
      sessionStartedAt: 1000,
      rev: 43,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect('rev' in parsed.data).toBe(false);
    expect(parsed.data.version).toBe(1);
  });
});
