import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadDraftIntoStore, setSessionConfig } from '../storeActions';
import { useContentStore } from '../useContentStore';
import { useTimerStore } from '../useTimerStore';
import { useSessionMetaStore } from '../useSessionMetaStore';

describe('storeActions', () => {
  beforeEach(() => {
    useContentStore.setState({
      content: '',
      title: '',
      wordCount: 0,
      lastWordCount: 0,
      wpm: 0,
      wordSnapshots: [],
      tags: [],
      pinnedThoughts: [],
      labelId: undefined,
    });
    useTimerStore.setState({
      status: 'idle',
      accumulatedDuration: 0,
      timeGoalReached: false,
      wordGoalReached: false,
      wordGoal: 0,
    });
    useSessionMetaStore.setState({
      savedDocumentId: null,
    });
  });

  describe('loadDraftIntoStore', () => {
    it('sets content, title, wordCount in useContentStore', () => {
      loadDraftIntoStore({
        content: 'Draft content',
        title: 'Draft Title',
        wordCount: 2,
        savedDocumentId: 'doc_123',
        accumulatedDuration: 50,
      });

      const contentState = useContentStore.getState();
      expect(contentState.content).toBe('Draft content');
      expect(contentState.title).toBe('Draft Title');
      expect(contentState.wordCount).toBe(2);
      expect(contentState.lastWordCount).toBe(2);
      expect(contentState.wpm).toBe(0);
      expect(contentState.wordSnapshots).toEqual([]);
    });

    it('sets idle status and accumulatedDuration in useTimerStore', () => {
      loadDraftIntoStore({
        content: 'Draft content',
        title: 'Draft Title',
        wordCount: 2,
        accumulatedDuration: 120,
      });

      const timerState = useTimerStore.getState();
      expect(timerState.status).toBe('idle');
      expect(timerState.accumulatedDuration).toBe(120);
      expect(timerState.timeGoalReached).toBe(false);
      expect(timerState.wordGoalReached).toBe(false);
    });

    it('sets savedDocumentId in useSessionMetaStore', () => {
      loadDraftIntoStore({
        content: 'Draft content',
        title: 'Draft Title',
        wordCount: 2,
        savedDocumentId: 'doc_abc',
      });
      expect(useSessionMetaStore.getState().savedDocumentId).toBe('doc_abc');
    });

    it('defaults accumulatedDuration to 0 when not provided', () => {
      loadDraftIntoStore({
        content: 'Draft content',
        title: 'Draft Title',
        wordCount: 2,
      });
      expect(useTimerStore.getState().accumulatedDuration).toBe(0);
    });
  });

  describe('setSessionConfig', () => {
    it('routes content keys to useContentStore', () => {
      setSessionConfig({
        content: 'New content',
        title: 'New title',
      });
      expect(useContentStore.getState().content).toBe('New content');
      expect(useContentStore.getState().title).toBe('New title');
    });

    it('routes timer keys to useTimerStore', () => {
      setSessionConfig({
        wordGoal: 300,
        status: 'writing',
      });
      expect(useTimerStore.getState().wordGoal).toBe(300);
      expect(useTimerStore.getState().status).toBe('writing');
    });

    it('routes meta keys to useSessionMetaStore', () => {
      setSessionConfig({
        savedDocumentId: 'doc_xyz',
      });
      expect(useSessionMetaStore.getState().savedDocumentId).toBe('doc_xyz');
    });

    it('handles mixed keys across all three stores', () => {
      setSessionConfig({
        content: 'Mixed content',
        wordGoal: 500,
        savedDocumentId: 'doc_mixed',
      });
      expect(useContentStore.getState().content).toBe('Mixed content');
      expect(useTimerStore.getState().wordGoal).toBe(500);
      expect(useSessionMetaStore.getState().savedDocumentId).toBe('doc_mixed');
    });

    it('sanitizes tags: slice(0,10), String(t).slice(0,50)', () => {
      const longTag = 'a'.repeat(60);
      const tags = ['tag1', longTag, 'tag3'];
      setSessionConfig({ tags });

      const storeTags = useContentStore.getState().tags;
      expect(storeTags).toHaveLength(3);
      expect(storeTags[1]).toBe('a'.repeat(50));
    });

    it('coerces non-array pinnedThoughts to []', () => {
      setSessionConfig({ pinnedThoughts: 'not-an-array' });
      expect(useContentStore.getState().pinnedThoughts).toEqual([]);
    });

    it('warns about unknown keys in dev mode', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Simulate dev mode
      vi.stubGlobal('import', {
        meta: {
          env: { DEV: true }
        }
      });

      setSessionConfig({ unknown_key: 'value' });
      expect(warnSpy).toHaveBeenCalled();
      
      warnSpy.mockRestore();
      vi.unstubAllGlobals();
    });
  });
});
