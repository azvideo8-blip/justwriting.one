import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onAuthStateChange, onTokenChange } from '../supabaseAuthProvider';
import { getSupabase } from '../../supabase/client';

vi.mock('../../supabase/client', () => ({
  getSupabase: vi.fn(),
}));

describe('supabaseAuthProvider - last-emitted-uid guard (AUTH-1)', () => {
  const mockUnsubscribe = vi.fn();
  let capturedListener: ((event: string, session: unknown) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedListener = null;

    vi.mocked(getSupabase).mockReturnValue({
      auth: {
        onAuthStateChange: vi.fn().mockImplementation((listener) => {
          capturedListener = listener;
          // Synchronously fire the callback three times with the same session.user.id
          // simulating INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED
          listener('INITIAL_SESSION', {
            user: { id: 'uid-test-1', email: 'test1@example.com', created_at: '2026-01-01', user_metadata: {} },
          });
          listener('SIGNED_IN', {
            user: { id: 'uid-test-1', email: 'test1@example.com', created_at: '2026-01-01', user_metadata: {} },
          });
          listener('TOKEN_REFRESHED', {
            user: { id: 'uid-test-1', email: 'test1@example.com', created_at: '2026-01-01', user_metadata: {} },
          });
          return {
            data: {
              subscription: {
                unsubscribe: mockUnsubscribe,
              },
            },
          };
        }),
      },
    } as unknown as ReturnType<typeof getSupabase>);
  });

  it('onAuthStateChange dedupes repeated emissions with the same uid to a single cb call', () => {
    const cb = vi.fn();

    const unsubscribe = onAuthStateChange(cb);

    // Initial 3 synchronous events with same uid should result in exactly 1 call
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(
      expect.objectContaining({
        uid: 'uid-test-1',
        email: 'test1@example.com',
      })
    );

    // Fourth event with a different uid must call cb again
    capturedListener!('USER_UPDATED', {
      user: { id: 'uid-test-2', email: 'test2@example.com', created_at: '2026-01-01', user_metadata: {} },
    });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(
      expect.objectContaining({
        uid: 'uid-test-2',
        email: 'test2@example.com',
      })
    );

    // A null session after a signed-in one must call cb with null
    capturedListener!('SIGNED_OUT', null);
    expect(cb).toHaveBeenCalledTimes(3);
    expect(cb).toHaveBeenLastCalledWith(null);

    // Repeated null emission (null -> null) should be a no-op
    capturedListener!('SIGNED_OUT', null);
    expect(cb).toHaveBeenCalledTimes(3);

    unsubscribe();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('onTokenChange dedupes repeated emissions with the same uid to a single cb call', () => {
    const cb = vi.fn();

    const unsubscribe = onTokenChange(cb);

    // Initial 3 synchronous events with same uid should result in exactly 1 call
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(
      expect.objectContaining({
        uid: 'uid-test-1',
        email: 'test1@example.com',
      })
    );

    // Fourth event with a different uid must call cb again
    capturedListener!('USER_UPDATED', {
      user: { id: 'uid-test-2', email: 'test2@example.com', created_at: '2026-01-01', user_metadata: {} },
    });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(
      expect.objectContaining({
        uid: 'uid-test-2',
        email: 'test2@example.com',
      })
    );

    // A null session after a signed-in one must call cb with null
    capturedListener!('SIGNED_OUT', null);
    expect(cb).toHaveBeenCalledTimes(3);
    expect(cb).toHaveBeenLastCalledWith(null);

    // Repeated null emission (null -> null) should be a no-op
    capturedListener!('SIGNED_OUT', null);
    expect(cb).toHaveBeenCalledTimes(3);

    unsubscribe();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('handles initial null emission followed by another null (null -> null no-op)', () => {
    vi.mocked(getSupabase).mockReturnValue({
      auth: {
        onAuthStateChange: vi.fn().mockImplementation((listener) => {
          capturedListener = listener;
          // Synchronously fire null session
          listener('INITIAL_SESSION', null);
          return {
            data: {
              subscription: {
                unsubscribe: mockUnsubscribe,
              },
            },
          };
        }),
      },
    } as unknown as ReturnType<typeof getSupabase>);

    const cb = vi.fn();
    onAuthStateChange(cb);

    // Initial null session emits null once
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(null);

    // Subsequent null session is a no-op
    capturedListener!('SIGNED_OUT', null);
    expect(cb).toHaveBeenCalledTimes(1);

    // Transition null -> uid fires
    capturedListener!('SIGNED_IN', {
      user: { id: 'uid-test-1', email: 'test1@example.com', created_at: '2026-01-01', user_metadata: {} },
    });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(
      expect.objectContaining({
        uid: 'uid-test-1',
      })
    );
  });
});
