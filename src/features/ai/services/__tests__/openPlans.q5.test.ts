import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { buildProactiveBlock } from '../chatContext/proactive';
import { AICommitmentService } from '../AICommitmentService';
import { extractDocumentIdsFromText } from '../AIMemoryAssembler';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';

// DLG-Q5 (Fable T-9): блок открытых планов печатал `- «текст» (создано: сегодня)`
// — createdAt это время извлечения, поэтому все планы выглядели «сегодня», а без
// id заметки модель сочиняла ссылки вида [#планирует-…]. Теперь у плана есть
// ссылка на заметку-источник, и её нужно разрешать в sanitizeCitations.
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const PLAN_TEXT = 'Записаться к стоматологу';

describe('Q-5: строка открытого плана', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('план печатается с id и датой заметки, без «создано:»', async () => {
    vi.spyOn(AICommitmentService, 'getOpenCommitments').mockResolvedValue([
      { id: 'c1', text: PLAN_TEXT, createdAt: Date.now(), date: '2026-09-20', documentId: 'local_abc' },
    ]);
    const block = await buildProactiveBlock({ personaId: 'coach', turnEmb: undefined });
    expect(block).toContain(`- «${PLAN_TEXT}» [#local_abc · 2026-09-20]`);
    expect(block).not.toContain('создано:');
  });

  it('шапка `[#id · дата]` даёт разрешённую ссылку, одиночные `[#id]` — как раньше', () => {
    expect(extractDocumentIdsFromText('[#local_abc · 2026-09-20]')).toEqual(['local_abc']);
    expect(extractDocumentIdsFromText('[#a][#b]')).toEqual(['a', 'b']);
    expect(extractDocumentIdsFromText('[#a · 2026-01-01] [#a · 2026-01-02]')).toEqual(['a']);
  });

  it('ход чата: id плана попадает в allowlist цитат, план из скрытой заметки — нет', async () => {
    const db = await getLocalDb();
    await db.put('documents', { id: 'local_open', title: 'Планы', currentVersion: 1, lastSessionAt: Date.now() } as never);
    await db.put('documents', { id: 'local_hidden', title: 'Личное', currentVersion: 1, lastSessionAt: Date.now(), excludedFromAI: true } as never);
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
    expect(ctx.searchContext ?? '').toContain('[#local_open · 2026-09-20]');
    expect(ctx.injectedDocumentIds).toContain('local_open');
    expect(ctx.injectedDocumentIds).not.toContain('local_hidden');
    expect(ctx.searchContext ?? '').not.toContain('SECRET');
  });
});
