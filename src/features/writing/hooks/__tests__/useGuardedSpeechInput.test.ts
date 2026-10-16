import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGuardedSpeechInput } from '../useGuardedSpeechInput';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

const mockStart = vi.fn();
const mockStop = vi.fn();
let mockIsListening = false;
let mockHasSupport = true;

vi.mock('../../../../shared/hooks/useSpeechInput', () => ({
  useSpeechInput: (_props: { onSessionEnd: (t: string) => void }) => ({
    isListening: mockIsListening,
    startListening: mockStart,
    stopListening: mockStop,
    hasSupport: mockHasSupport,
  }),
}));

const mockConfirm = vi.fn();
vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
  }),
}));

let mockUser: { uid: string } | null = null;
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({
    user: mockUser,
  }),
}));

let mockVaultEnabled = false;
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: {
    getState: () => ({
      getEncryptionEnabled: (_uid: string) => mockVaultEnabled,
    }),
  },
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
  }),
}));

describe('useGuardedSpeechInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockIsListening = false;
    mockHasSupport = true;
    mockUser = null;
    mockVaultEnabled = false;
  });

  it('prompts first-time user for confirmation before starting dictation', async () => {
    mockConfirm.mockResolvedValue(true);
    const { result } = renderHook(() => useGuardedSpeechInput({ onSessionEnd: vi.fn() }));

    expect(result.current.isListening).toBe(false);
    await act(async () => {
      await result.current.toggleListening();
    });

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'voice_confirm_title',
      message: 'voice_confirm_desc',
    }));
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN)).toBe('1');
  });

  it('does not prompt again once notice has been seen for non-vault users', async () => {
    // D-5: предупреждение переписано, поэтому его актуальная версия — v2.
    // Ассерт прежний: видевший текущее предупреждение не дерётся вторично.
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN, '1');
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2('guest'), '1');
    const { result } = renderHook(() => useGuardedSpeechInput({ onSessionEnd: vi.fn() }));

    await act(async () => {
      await result.current.toggleListening();
    });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('D-5: показавший v1 видит переписанное предупреждение ещё раз — и только один раз', async () => {
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN, '1');
    mockConfirm.mockResolvedValue(true);
    const { result } = renderHook(() => useGuardedSpeechInput({ onSessionEnd: vi.fn() }));

    await act(async () => { await result.current.toggleListening(); });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'voice_confirm_desc' }));
    expect(localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2('guest'))).toBe('1');
    expect(mockStart).toHaveBeenCalledTimes(1);

    mockConfirm.mockClear();
    await act(async () => { await result.current.toggleListening(); });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('does not start listening if user cancels first-time prompt', async () => {
    mockConfirm.mockResolvedValue(false);
    const { result } = renderHook(() => useGuardedSpeechInput({ onSessionEnd: vi.fn() }));

    await act(async () => {
      await result.current.toggleListening();
    });

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockStart).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN)).toBeNull();
  });

  it('always prompts vault users with vault warning, even if notice was seen', async () => {
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN, '1');
    mockUser = { uid: 'vault_user_1' };
    mockVaultEnabled = true;
    mockConfirm.mockResolvedValue(true);

    const { result } = renderHook(() => useGuardedSpeechInput({ onSessionEnd: vi.fn() }));
    expect(result.current.isVaultActive).toBe(true);

    await act(async () => {
      await result.current.toggleListening();
    });

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'voice_confirm_title',
      message: 'voice_confirm_vault_desc',
    }));
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('stops listening if already listening without prompting', async () => {
    mockIsListening = true;
    const { result } = renderHook(() => useGuardedSpeechInput({ onSessionEnd: vi.fn() }));

    await act(async () => {
      await result.current.toggleListening();
    });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });
});
