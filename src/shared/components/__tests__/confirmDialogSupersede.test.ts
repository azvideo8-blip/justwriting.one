import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfirmDialog } from '../ConfirmDialog';

describe('B-5.1 (F-028) ConfirmDialog superseding previous dialogs', () => {
  it('resolves the first confirm promise with false when a second dialog is opened', async () => {
    const { result } = renderHook(() => useConfirmDialog());

    let firstPromise!: Promise<boolean>;
    let secondPromise!: Promise<boolean>;
    act(() => {
      firstPromise = result.current.confirm({ title: 'First Dialog' });
      secondPromise = result.current.confirm({ title: 'Second Dialog' });
    });

    const firstResult = await firstPromise;
    expect(firstResult).toBe(false);
    void secondPromise;
  });

  it('resolves the first prompt promise with null when a second dialog is opened', async () => {
    const { result } = renderHook(() => useConfirmDialog());

    let firstPrompt!: Promise<string | null>;
    let secondPrompt!: Promise<string | null>;
    act(() => {
      firstPrompt = result.current.prompt({ title: 'First Prompt' });
      secondPrompt = result.current.prompt({ title: 'Second Prompt' });
    });

    const firstResult = await firstPrompt;
    expect(firstResult).toBe(null);
    void secondPrompt;
  });

  it('resolves the first alert promise when a second dialog is opened', async () => {
    const { result } = renderHook(() => useConfirmDialog());

    let alertResolved = false;
    act(() => {
      void result.current.alert({ title: 'First Alert' }).then(() => {
        alertResolved = true;
      });
      void result.current.confirm({ title: 'Second Dialog' });
    });

    await Promise.resolve();
    expect(alertResolved).toBe(true);
  });
});
