// Приёмка VIS, ревьюер 05.11: у гостя свой писатель (`useDraftManager`), и снятие баннера при
// стёртом тексте, сделанное в `useDraftAutosave`, до него не доходило.
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContentStore } from '../../store/useContentStore';
import { useDraftWriteAlertStore } from '../../store/useDraftWriteAlertStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { useDraftManager } from '../useDraftManager';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const settle = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
const type = async (text: string) => {
  await act(async () => { useContentStore.getState().setContent(text); });
  await settle(1200);
};

beforeEach(() => {
  useContentStore.setState({ content: '', title: '' });
  useDraftWriteAlertStore.setState({ localWriteStuck: false });
});

describe('гость: баннер «только на экране»', () => {
  it('гость стёр текст после двух отказов: баннер снят', async () => {
    const onSaveDraft = vi.fn(async () => { throw new Error('запись отказала'); });
    const getData = () => {
      const s = useContentStore.getState();
      return { content: s.content, title: s.title, pinnedThoughts: [], seconds: 0, wpm: 0, wordCount: 1, activeSessionId: null, status: 'writing' };
    };
    const { unmount } = renderHook(() => useDraftManager('guest_vis', getData as never, { onSaveDraft }));
    await type('а');
    await type('аб');
    expect(useDraftWriteAlertStore.getState().localWriteStuck, 'два отказа подряд не подняли баннер').toBe(true);
    await type('');
    expect(useDraftWriteAlertStore.getState().localWriteStuck, 'баннер висит над пустым редактором').toBe(false);
    unmount();
  });

  it('Н-5: гость отменил правки до сохранённой заметки — баннер снят', async () => {
    const onSaveDraft = vi.fn(async () => { throw new Error('запись отказала'); });
    const getData = () => {
      const s = useContentStore.getState();
      return { content: s.content, title: s.title, pinnedThoughts: [], seconds: 0, wpm: 0, wordCount: 1, activeSessionId: null, status: 'writing' };
    };
    useSessionMetaStore.setState({ savedDocumentId: 'note_n5', loadedContent: 'сохранённая заметка', loadedTitle: '' });
    const { unmount } = renderHook(() => useDraftManager('guest_vis_n5', getData as never, { onSaveDraft }));
    await type('сохранённая заметка и правка');
    await type('сохранённая заметка и ещё правка');
    expect(useDraftWriteAlertStore.getState().localWriteStuck, 'два отказа подряд не подняли баннер').toBe(true);
    await type('сохранённая заметка');
    expect(useDraftWriteAlertStore.getState().localWriteStuck, 'баннер «только на экране» над сохранённым текстом').toBe(false);
    useSessionMetaStore.setState({ savedDocumentId: null, loadedContent: null, loadedTitle: null });
    unmount();
  });
});
