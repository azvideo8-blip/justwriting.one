// Ревью Qoder 0.11.10: догадка разбора периода не сужает архив. Если в окне
// периода нет ни одной заметки, поиск хода идёт по всему архиву, а модель
// узнаёт, что за этот период записей нет.
// Мутация: убрать ветку `noteCountForPeriod === 0` → красный «пустое окно».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../../core/storage/localDb';
import { buildTemporalBlocks } from '../temporalBlocks';

vi.mock('../../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const doc = (id: string, at: number) => ({ id, guestId: 'guest', title: id, currentVersion: 1, totalWords: 5, totalDuration: 0, sessionsCount: 1, firstSessionAt: at, lastSessionAt: at, tags: [] });

describe('пустое окно периода не сужает поиск', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    await db.clear('documents');
    await db.put('documents', doc('n_2026', new Date(2026, 4, 10, 12).getTime()) as never);
  });

  const run = async (text: string) => buildTemporalBlocks({ text, effectiveQuery: text, explicitSearch: false, lastSearchQuery: '', db: await getLocalDb(), carriedWindow: undefined });

  it('пустое окно → без границ поиска и с пометкой для модели', async () => {
    const r = await run('что я писала в марте 2020');
    expect(r.outcome.minTime).toBeUndefined();
    expect(r.outcome.maxTime).toBeUndefined();
    expect(r.appended).toContain('За названный период записей нет');
  });

  it('в окне есть заметка → окно сохраняется', async () => {
    const r = await run('что я писала в мае 2026');
    expect(r.outcome.minTime).toBeDefined();
    expect(r.appended).not.toContain('За названный период записей нет');
  });
});
