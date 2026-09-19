import { describe, it, expect, vi, beforeEach } from 'vitest';

let currentUid: string | null = 'user-A';

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => (currentUid ? { uid: currentUid } : null),
}));

const { AITaxonomyService, taxonomyKey, TAXONOMY_LS_KEY } = await import('../AITaxonomyService');
const { AIFacetJudgeService, judgeLogKey, JUDGE_LOG_KEY } = await import('../AIFacetJudgeService');
const { accountScopedLocalStorageKeys, clearAccountScopedStorage } = await import('../../../auth/services/accountScopedKeys');

describe('LS-1: AI localStorage keys scoped to account (ai_taxonomy, ai_judge_log)', () => {
  beforeEach(() => {
    localStorage.clear();
    currentUid = 'user-A';
  });

  it('taxonomy saved by user A is not visible to user B (cross-account isolation)', () => {
    const mockDomains = [
      { id: 'd1', label: 'Работа', seed: 'проект дедлайн', derivedAt: 1000, noteCountAtDerive: 5, source: 'derived' as const },
    ];

    // User A saves taxonomy
    AITaxonomyService.save(mockDomains);
    expect(AITaxonomyService.getStored()).toEqual(mockDomains);

    // Switch to User B
    currentUid = 'user-B';
    expect(AITaxonomyService.getStored()).toBeNull();
  });

  it('legacy unscoped ai_taxonomy is migrated on first read for signed-in user and cleaned up', () => {
    const legacyTaxonomy = {
      version: 1,
      domains: [{ id: 'd_leg', label: 'Семья', seed: 'дом дети', derivedAt: 500, noteCountAtDerive: 3, source: 'derived' }],
    };
    localStorage.setItem(TAXONOMY_LS_KEY, JSON.stringify(legacyTaxonomy));

    const stored = AITaxonomyService.getStored();
    expect(stored).toEqual(legacyTaxonomy.domains);

    // Legacy key must have been removed, and scoped key created
    expect(localStorage.getItem(TAXONOMY_LS_KEY)).toBeNull();
    expect(localStorage.getItem(taxonomyKey('user-A'))).not.toBeNull();
  });

  it('judge log for user A is not visible to user B', () => {
    currentUid = 'user-A';
    localStorage.setItem(judgeLogKey('user-A'), JSON.stringify({ at: 1000, entries: [{ label: 'Работа', status: 'ok', issues: [] }] }));

    currentUid = 'user-B';
    expect(AIFacetJudgeService.getLog()).toBeNull();
  });

  it('legacy unscoped ai_judge_log is migrated on first read and cleaned up', () => {
    const legacyLog = { at: 1234, entries: [{ label: 'Доверие', status: 'flagged', issues: ['Too broad'] }] };
    localStorage.setItem(JUDGE_LOG_KEY, JSON.stringify(legacyLog));

    const log = AIFacetJudgeService.getLog();
    expect(log).toEqual(legacyLog);

    expect(localStorage.getItem(JUDGE_LOG_KEY)).toBeNull();
    expect(localStorage.getItem(judgeLogKey('user-A'))).not.toBeNull();
  });

  it('clearAccountScopedStorage removes both taxonomy and judge log for that user', () => {
    localStorage.setItem(taxonomyKey('user-A'), 'taxonomy-A');
    localStorage.setItem(taxonomyKey('user-B'), 'taxonomy-B');
    localStorage.setItem(judgeLogKey('user-A'), 'judge-A');
    localStorage.setItem(judgeLogKey('user-B'), 'judge-B');

    clearAccountScopedStorage('user-A');

    expect(localStorage.getItem(taxonomyKey('user-A'))).toBeNull();
    expect(localStorage.getItem(judgeLogKey('user-A'))).toBeNull();
    expect(localStorage.getItem(taxonomyKey('user-B'))).toBe('taxonomy-B');
    expect(localStorage.getItem(judgeLogKey('user-B'))).toBe('judge-B');
  });

  it('both keys are declared in accountScopedLocalStorageKeys', () => {
    const keys = accountScopedLocalStorageKeys('user-A');
    expect(keys).toContain(taxonomyKey('user-A'));
    expect(keys).toContain(judgeLogKey('user-A'));
  });
});
