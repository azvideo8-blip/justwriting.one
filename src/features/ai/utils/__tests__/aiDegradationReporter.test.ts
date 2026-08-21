import { describe, it, expect, beforeEach } from 'vitest';
import { reportAIDegradation, resetAIDegradationSession, classifyCause, isDailyLimitError } from '../aiDegradationReporter';
import { useActivityLogStore } from '../../../../shared/activity/useActivityLogStore';

describe('aiDegradationReporter', () => {
  beforeEach(() => {
    resetAIDegradationSession();
    useActivityLogStore.getState().clearLog();
  });

  describe('classifyCause', () => {
    it('identifies daily limit errors', () => {
      expect(isDailyLimitError('DAILY_LIMIT')).toBe(true);
      expect(isDailyLimitError('RATE_LIMIT')).toBe(true);
      expect(isDailyLimitError(new Error('Daily limit reached'))).toBe(true);
      expect(classifyCause('DAILY_LIMIT').category).toBe('daily_limit');
    });

    it('identifies transient network / upstream errors', () => {
      expect(classifyCause('NETWORK').category).toBe('transient');
      expect(classifyCause('UPSTREAM').category).toBe('transient');
      expect(classifyCause(new Error('functions/unavailable')).category).toBe('transient');
      expect(classifyCause(new Error('Timeout')).category).toBe('transient');
    });

    it('identifies misconfiguration errors', () => {
      expect(classifyCause('AUTH_REQUIRED').category).toBe('misconfiguration');
      expect(classifyCause('MISCONFIGURED').category).toBe('misconfiguration');
      expect(classifyCause({ code: 'functions/unauthenticated' }).category).toBe('misconfiguration');
    });

    it('identifies generic server errors', () => {
      expect(classifyCause('SERVER_ERROR').category).toBe('server_error');
    });
  });

  describe('reportAIDegradation session deduplication', () => {
    it('creates a single entry for daily limit and increments count on repeated calls across different features', () => {
      reportAIDegradation({
        feature: 'search_rerank',
        cause: 'DAILY_LIMIT',
        impact: 'RRF fallback used',
      });

      let entries = useActivityLogStore.getState().entries;
      expect(entries).toHaveLength(1);
      expect(entries[0]?.message).toContain('Дневной лимит ИИ исчерпан');
      expect(entries[0]?.count).toBe(1);
      expect(entries[0]?.level).toBe('warning');

      // Second call from a different feature (e.g. chat_search_embed) with same cause
      reportAIDegradation({
        feature: 'chat_search_embed',
        cause: 'DAILY_LIMIT',
        impact: 'Note retrieval skipped',
      });

      entries = useActivityLogStore.getState().entries;
      expect(entries).toHaveLength(1);
      expect(entries[0]?.count).toBe(2);

      // Third call from yet another feature (e.g. facet_builder)
      reportAIDegradation({
        feature: 'facet_builder',
        cause: 'DAILY_LIMIT',
        impact: 'Facets not tuned',
      });

      entries = useActivityLogStore.getState().entries;
      expect(entries).toHaveLength(1);
      expect(entries[0]?.count).toBe(3);
    });

    it('creates separate entries for different cause categories', () => {
      reportAIDegradation({
        feature: 'search_rerank',
        cause: 'DAILY_LIMIT',
      });

      reportAIDegradation({
        feature: 'chat_stream',
        cause: 'NETWORK',
      });

      const entries = useActivityLogStore.getState().entries;
      expect(entries).toHaveLength(2);
      expect(entries.some(e => e.message.includes('Дневной лимит'))).toBe(true);
      expect(entries.some(e => e.message.includes('Временный сбой'))).toBe(true);
    });
  });
});
