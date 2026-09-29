import { describe, it, expect } from 'vitest';
import { BASELINE_HEADER, planBaseline } from '../knip-ratchet.mjs';

// C-2 (R2-020). До этого `--update` писал весь текущий набор и выходил 0, то
// есть один прогон легализовал сколько угодно нового мёртвого кода — храповик,
// который крутится в обе стороны.
describe('planBaseline', () => {
  const dead = 'exports\tsrc/shared/utils/cn.ts:deadExport';

  it('refuses to write a baseline containing a key that was not there before', () => {
    const plan = planBaseline([], [dead]);
    expect(plan.mayWrite).toBe(false);
    expect(plan.added).toEqual([dead]);
  });

  it('lets --update shrink the baseline', () => {
    const stale = 'files\tsrc/shared/utils/old.ts';
    const plan = planBaseline([stale, dead], [dead]);
    expect(plan.mayWrite).toBe(true);
    expect(plan.removed).toEqual([stale]);
    expect(plan.added).toEqual([]);
  });

  it('writes only the keys knip reports now, header included', () => {
    const plan = planBaseline(['files\tsrc/a.ts'], [dead]);
    expect(plan.contents).toBe(`${BASELINE_HEADER}\n${dead}\n`);
    expect(plan.contents).not.toContain('src/a.ts');
  });

  it('is a no-op write when nothing changed', () => {
    const plan = planBaseline([dead], [dead]);
    expect(plan.mayWrite).toBe(true);
    expect(plan.added).toEqual([]);
    expect(plan.removed).toEqual([]);
  });

  // Рост возможен, но только по явному флагу — и тогда добавленные ключи
  // попадают в отчёт, а не исчезают в файле молча.
  it('grows only when asked, and prints what it added', () => {
    const plan = planBaseline([], [dead], { grow: true });
    expect(plan.mayWrite).toBe(true);
    expect(plan.added).toEqual([dead]);
    expect(plan.contents).toContain('deadExport');
  });
});
