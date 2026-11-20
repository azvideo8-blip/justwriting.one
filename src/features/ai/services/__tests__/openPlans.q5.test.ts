import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { buildProactiveBlock } from '../chatContext/proactive';
import { AICommitmentService } from '../AICommitmentService';
import { extractCitationIds } from '../chatContext/citations';

const extractDocumentIdsFromText = (t: string) => [...new Set(extractCitationIds(t))];
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

// DLG-Q5 (Fable T-9): блок открытых планов печатал `- «текст» (создано: сегодня)`
// — createdAt это время извлечения, поэтому все планы выглядели «сегодня», а без
// id заметки модель сочиняла ссылки вида [#планирует-…]. Теперь у плана есть
// ссылка на заметку-источник, и её нужно разрешать в sanitizeCitations.
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const PLAN_TEXT = 'Записаться к стоматологу';

describe('Q-5: строка открытого плана', () => {
  // Планы старше 60 дней блок не показывает (MB-3), а дата плана в тесте
  // постоянная — без своих «часов» тест сам истёк 20.11.2026.
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('план печатается с id и датой заметки, без «создано:»', async () => {
    vi.spyOn(AICommitmentService, 'getOpenCommitments').mockResolvedValue([
      { id: 'c1', text: PLAN_TEXT, createdAt: Date.now(), date: '2026-09-20', documentId: 'local_abc' },
    ]);
    const block = await buildProactiveBlock({ personaId: 'coach' });
    expect(block).toContain(`- «${PLAN_TEXT}» [#local_abc · 20260920]`);
    expect(block).not.toContain('создано:');
  });

  it('шапка `[#id · дата]` даёт разрешённую ссылку, одиночные `[#id]` — как раньше', () => {
    expect(extractDocumentIdsFromText('[#local_abc · 2026-09-20]')).toEqual(['local_abc']);
    expect(extractDocumentIdsFromText('[#a][#b]')).toEqual(['a', 'b']);
    expect(extractDocumentIdsFromText('[#a · 2026-01-01] [#a · 2026-01-02]')).toEqual(['a']);
    // П2 (самопроверка): импортированные заметки живут по номеру с точкой, и без
    // неё ссылка модели на такой план вырезалась — id вообще не доходил до allowlist.
    expect(extractDocumentIdsFromText('[#1720194283.716586 · 20260920]')).toEqual(['1720194283.716586']);
    expect(extractDocumentIdsFromText('[- #planned-что-то]')).toEqual([]);
  });

  it('дата в шапке плана — как у шапок заметок, без дефисов', async () => {
    vi.spyOn(AICommitmentService, 'getOpenCommitments').mockResolvedValue([
      { id: 'c1', text: PLAN_TEXT, createdAt: Date.now(), date: '20260920', documentId: 'local_abc' },
    ]);
    const block = await buildProactiveBlock({ personaId: 'coach' });
    expect(block).toContain(`- «${PLAN_TEXT}» [#local_abc · 20260920]`);
  });

  it('ход чата: id плана попадает в allowlist цитат, план из скрытой заметки — нет', async () => {
    const db = await getLocalDb();
    await db.put('documents', { id: 'local_open', title: 'Планы', currentVersion: 1, lastSessionAt: Date.now() } as never);
    await markAllAnalysed(db);
    await db.put('documents', { id: 'local_hidden', title: 'Личное', currentVersion: 1, lastSessionAt: Date.now(), excludedFromAI: true } as never);
    await markAllAnalysed(db);
    const now = Date.now();
    await db.put('aiCommitments', { id: 'k1', text: 'Позвонить маме', documentId: 'local_open', createdAt: now, date: '2026-09-20', status: 'open' } as never);
    await db.put('aiCommitments', { id: 'k2', text: 'SECRET план из скрытой заметки', documentId: 'local_hidden', createdAt: now, date: '2026-09-21', status: 'open' } as never);

    const open = await AICommitmentService.getOpenCommitments();
    expect(open.map(c => c.documentId)).toEqual(['local_open']);
    expect(JSON.stringify(open)).not.toContain('SECRET');

    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await result.current.buildContext({
      text: 'что я собирался сделать в последнее время',
      attached: null,
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
    });
    expect(ctx.searchContext ?? '').toContain('[#local_open · 20260920]');
    expect(ctx.injectedDocumentIds).toContain('local_open');
    expect(ctx.injectedDocumentIds).not.toContain('local_hidden');
    expect(ctx.searchContext ?? '').not.toContain('SECRET');
  });
});

// MB-3 (N-2): «Разобрать архив» открывает планы всего архива разом — блок
// первого хода раздувался до сотен строк. Потолок 15, свежие заметки первыми,
// только заметки не старше 60 дней, в шапке — сколько не показано.
describe('MB-3: потолок блока открытых планов', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const plan = (i: number, date: string) => ({
    id: `c${i}`, text: `план-${String(i).padStart(2, '0')}`, createdAt: Date.now(), date, documentId: `local_${i}`,
  });

  it('40 планов → в блоке 15, самый свежий первым, в шапке — сколько не показано', async () => {
    // Даты за последние 40 дней, порядок перемешан — сортировка по дате заметки.
    const plans = Array.from({ length: 40 }, (_, i) => {
      const d = new Date(2026, 9, 6 - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return plan(i, iso);
    }).reverse();
    vi.spyOn(AICommitmentService, 'getOpenCommitments').mockResolvedValue(plans);

    const block = await buildProactiveBlock({ personaId: 'coach' });
    const lines = block.split('\n').filter(l => l.startsWith('- «план-'));
    expect(lines).toHaveLength(15);
    expect(lines[0]).toContain('план-00');
    expect(block).toContain('(не показано: 25)');
    expect(block).not.toContain('план-39');
  });

  it('план из заметки старше 60 дней отсутствует, ровно 60 дней — ещё показывается', async () => {
    vi.spyOn(AICommitmentService, 'getOpenCommitments').mockResolvedValue([
      plan(1, '2026-10-01'),
      plan(2, '2026-08-08'), // ровно 60 дней до 2026-10-07
      plan(3, '2026-08-07'), // 61 день
      plan(4, '2026-01-05'),
    ]);
    const block = await buildProactiveBlock({ personaId: 'coach' });
    expect(block).toContain('план-01');
    expect(block).toContain('план-02');
    expect(block).not.toContain('план-03');
    expect(block).not.toContain('план-04');
  });

  it('все планы старые → блока нет', async () => {
    vi.spyOn(AICommitmentService, 'getOpenCommitments').mockResolvedValue([plan(1, '2026-01-05')]);
    const block = await buildProactiveBlock({ personaId: 'coach' });
    expect(block).not.toContain('[Открытые планы');
  });
});
