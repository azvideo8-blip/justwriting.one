import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { clearAccountScopedStorage } from '../../../auth/services/accountScopedKeys';

/** Отметка гостя не должна переживать выход зарегистрированного аккаунта. */
function clearAccountScopedStorageGuarded(uid: string): boolean {
  localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2('guest'), '1');
  clearAccountScopedStorage(uid);
  return localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2('guest')) === null;
}

// R7F-015: флаг «уведомление о диктовке показано» жил на устройстве, а не на
// аккаунте. Второй человек за тем же браузером предупреждения не видел вообще:
// «аудио уходит в Google/Apple, а текст — в ИИ-сервис за знаками препинания».
// Мобильный лист тем временем спрашивает отметку по uid (DICTATION_NOTICE_DISMISSED),
// то есть в одном месте задачи уже считались личными, а в другом — общими.

const mockStart = vi.fn();
const mockStop = vi.fn();
let mockIsListening = false;
const mockConfirm = vi.fn(async () => true);
let mockUser: { uid: string } | null = null;

vi.mock('../../../../shared/hooks/useSpeechInput', () => ({
  useSpeechInput: () => ({
    isListening: mockIsListening,
    startListening: mockStart,
    stopListening: mockStop,
    hasSupport: true,
  }),
}));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: mockConfirm }),
}));
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: mockUser }),
}));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: { getState: () => ({ getEncryptionEnabled: () => false }) },
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));

import { useGuardedSpeechInput, voiceNoticeDecision } from '../useGuardedSpeechInput';

const A = 'uid-first';
const B = 'uid-second';

function toggle() {
  const { result } = renderHook(() => useGuardedSpeechInput({ onSessionEnd: () => undefined }));
  act(() => { void result.current.toggleListening(); });
}

describe('R7F-015: предупреждение о диктовке — по аккаунту', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockIsListening = false;
    mockConfirm.mockResolvedValue(true);
  });

  it('первый аккаунт увидел предупреждение, второй видит своё', async () => {
    mockUser = { uid: A };
    toggle();
    await vi.waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2(A))).toBe('1');

    mockConfirm.mockClear();
    mockUser = { uid: B };
    toggle();
    await vi.waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(mockStart, 'после подтверждения запись стартует').toHaveBeenCalled();
  });

  it('отметка первого не перекрывает решение второго в мобильном листе', () => {
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2(A), '1');
    expect(voiceNoticeDecision(A, false), 'первый уже видел — дальше лист по галочке').toBe('sheet');
    expect(voiceNoticeDecision(B, false), 'второй не видел — лист обязан спросить').toBe('sheet');
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2(B), '1');
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_DISMISSED(B), '1');
    expect(voiceNoticeDecision(B, false), 'второй видел и снял галочку — старт без листа').toBe('start');
    expect(voiceNoticeDecision(A, false), 'но не за первого').toBe('sheet');
  });

  it('прежняя отметка на устройство больше не заглушает предупреждение новому аккаунту', async () => {
    // Этот кейс написан через сырой строковый ключ и потому читается и на базе,
    // и с правкой: на базе общий флаг глушил второму человеку предупреждение
    // вовсе (красный), с правкой флаг по аккаунту — предупреждение приходит.
    localStorage.setItem('jw_dictation_notice_seen_v2', '1');
    mockUser = { uid: B };
    toggle();
    await vi.waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('гость живёт под гостевым ключом, а не под «undefined» и не вместо аккаунта', async () => {
    mockUser = null;
    toggle();
    await vi.waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2('guest')), 'отметка гостя')
      .toBe('1');
    expect(localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2('undefined'))).toBeNull();
    // Гость — не «другой зарегистрированный аккаунт»: выход пользователя его
    // отметку стирает (LS-6), а не защищает.
    expect(clearAccountScopedStorageGuarded('uid-owner')).toBe(true);
  });
});
