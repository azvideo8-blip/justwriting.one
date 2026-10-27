import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AICommitmentService } from '../AICommitmentService';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

// Ревью 0.10.13: открытые планы шли в блок «Изменения за последнее время» по
// списку СКРЫТЫХ заметок — план удалённой заметки (или приехавший с другого
// устройства с чужим локальным id) в этот список не попадал и уходил модели.
// Тот же класс, что TH-3 у хронологии: «нет заметки» = «нельзя» (S-51).
// Мутация: вернуть фильтр по списку скрытых → красный. Маркеры выдуманные.
describe('ревью 0.10.13: план удалённой заметки не уходит в чат', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    for (const s of ['documents', 'aiCommitments'] as const) await db.clear(s);
    await db.put('documents', { id: 'doc_ok_r13', title: 'т', currentVersion: 1, lastSessionAt: Date.now() } as never);
    for (const [id, doc, text] of [['c1', 'doc_ok_r13', 'ПЛАН_ВИДИМЫЙ_R13'], ['c2', 'doc_gone_r13', 'ПЛАН_УДАЛЁННОЙ_R13']] as const) {
      await db.put('aiCommitments', { id, text, documentId: doc, createdAt: Date.now(), date: '2026-10-27', status: 'open' });
    }
  });

  it('видимая заметка — план есть, удалённой — нет', async () => {
    const texts = (await AICommitmentService.getOpenCommitments()).map(c => c.text);
    expect(texts).toContain('ПЛАН_ВИДИМЫЙ_R13');
    expect(texts, 'план удалённой заметки ушёл в чат').not.toContain('ПЛАН_УДАЛЁННОЙ_R13');
  });
});
