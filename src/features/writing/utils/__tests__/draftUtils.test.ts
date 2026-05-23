import { describe, it, expect, beforeEach } from 'vitest';
import { applyDraftToStores } from '../draftUtils';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';

describe('applyDraftToStores', () => {
  beforeEach(() => {
    // Reset stores
    useContentStore.setState({
      content: '',
      title: '',
      wordCount: 0,
      pinnedThoughts: [],
      tags: [],
      labelId: undefined,
      initialWordCount: 0,
    });
    useTimerStore.setState({
      seconds: 0,
      accumulatedDuration: 0,
      totalPauseSeconds: 0,
      sessionStartWords: 0,
      sessionStartSeconds: 0,
    });
    useSessionMetaStore.setState({
      savedDocumentId: null,
      sessionStartTime: null,
      activeSessionId: null,
    });
  });

  it('writes content, title, wordCount to useContentStore', () => {
    applyDraftToStores({
      content: 'Hello world',
      title: 'My Title',
      wordCount: 2,
    });

    const contentState = useContentStore.getState();
    expect(contentState.content).toBe('Hello world');
    expect(contentState.title).toBe('My Title');
    expect(contentState.wordCount).toBe(2);
  });

  it('writes pinnedThoughts as array, defaults to []', () => {
    applyDraftToStores({
      pinnedThoughts: ['Thought 1'],
    });
    expect(useContentStore.getState().pinnedThoughts).toEqual(['Thought 1']);

    applyDraftToStores({});
    expect(useContentStore.getState().pinnedThoughts).toEqual([]);
  });

  it('writes tags as array, defaults to []', () => {
    applyDraftToStores({
      tags: ['Tag 1'],
    });
    expect(useContentStore.getState().tags).toEqual(['Tag 1']);

    applyDraftToStores({});
    expect(useContentStore.getState().tags).toEqual([]);
  });

  it('writes seconds, accumulatedDuration to useTimerStore', () => {
    applyDraftToStores({
      seconds: 120,
      accumulatedDuration: 180,
      totalPauseSeconds: 15,
    });

    const timerState = useTimerStore.getState();
    expect(timerState.seconds).toBe(120);
    expect(timerState.accumulatedDuration).toBe(180);
    expect(timerState.totalPauseSeconds).toBe(15);
  });

  it('writes savedDocumentId to useSessionMetaStore', () => {
    applyDraftToStores({
      savedDocumentId: 'doc_123',
    });
    expect(useSessionMetaStore.getState().savedDocumentId).toBe('doc_123');
  });

  it('sets activeSessionId when provided', () => {
    applyDraftToStores({
      activeSessionId: 'session_abc',
    });
    expect(useSessionMetaStore.getState().activeSessionId).toBe('session_abc');
  });

  it('handles null/undefined fields gracefully', () => {
    applyDraftToStores({
      content: undefined,
      title: undefined,
      pinnedThoughts: undefined,
      tags: undefined,
      savedDocumentId: null,
    });

    const contentState = useContentStore.getState();
    expect(contentState.content).toBe('');
    expect(contentState.title).toBe('');
    expect(contentState.pinnedThoughts).toEqual([]);
    expect(contentState.tags).toEqual([]);

    expect(useSessionMetaStore.getState().savedDocumentId).toBeNull();
  });
});
