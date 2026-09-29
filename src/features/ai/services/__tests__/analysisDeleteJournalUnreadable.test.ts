// R3-012: нечитаемый журнал облачных удалений разборов не перезаписывается
// новым элементом — иначе прежние незакрытые удаления терялись молча.
import { describe, it, expect, vi } from 'vitest';
import { persistPendingAnalysisDelete, forgetPendingAnalysisDelete, getPendingAnalysisDeleteKeys } from '../pendingAnalysisDeletes';
import { reportError } from '../../../../shared/errors/reportError';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/data', () => ({ DataProvider: {} }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => null }));

const KEY = 'ai_sync_pending_analysis_deletes';

describe('журнал удалений разборов', () => {
  it('битый журнал остаётся как есть, о нём сказано вслух', () => {
    const raw = '[{"uid":"u","canonicalId":"a"},{"uid":"u","canonicalId":"b"';
    localStorage.setItem(KEY, raw);
    persistPendingAnalysisDelete('u', 'c');
    forgetPendingAnalysisDelete('u', 'a');
    expect(localStorage.getItem(KEY)).toBe(raw);
    expect(getPendingAnalysisDeleteKeys('u')).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
