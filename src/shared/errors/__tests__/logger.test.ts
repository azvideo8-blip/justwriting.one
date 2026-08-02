import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReport = vi.fn();
vi.mock('../reportError', () => ({ reportError: (...a: unknown[]) => mockReport(...a) }));

import { logger } from '../logger';

// warn в проде не делал ничего: консоль только в DEV, до отчётов доходили
// лишь error. Так терялись сбои удаления черновика и облачной синхронизации.
describe('logger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports a warning, at warning level', () => {
    logger.warn('sync', 'could not delete draft', { documentId: 'd1' });

    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport.mock.calls[0]![2]).toBe('warning');
  });

  it('still reports an error at error level', () => {
    logger.error('sync', 'upload failed');

    expect(mockReport.mock.calls[0]![2]).toBe('error');
  });

  it('does not report info', () => {
    logger.info('sync', 'started');

    expect(mockReport).not.toHaveBeenCalled();
  });
});
