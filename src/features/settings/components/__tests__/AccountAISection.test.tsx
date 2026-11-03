import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { renderWithProviders } from '../../../../test/utils/render';
import { AccountAISection } from '../AccountAISection';
import { SUPPORTED_LOCAL_STORES } from '../../../../core/services/LocalStoreSyncService';
import { getSendPortraitInDialogue, usePortraitDialoguePreferenceStore } from '../../../../core/ai/portraitDialoguePreference';

const {
  executionLog,
  mockDeleteAllEmbeddings,
  mockDeleteAllSummaries,
  mockDeleteLocalStoreRecordsByStores,
  mockUpdateProfile,
  mockClear,
  mockGetAll,
  mockPut,
  mockConfirm,
  mockShowToast,
} = vi.hoisted(() => {
  const executionLog: string[] = [];
  return {
    executionLog,
    mockDeleteAllEmbeddings: vi.fn(),
    mockDeleteAllSummaries: vi.fn(),
    mockDeleteLocalStoreRecordsByStores: vi.fn(),
    mockUpdateProfile: vi.fn(),
    mockClear: vi.fn(),
    mockGetAll: vi.fn().mockResolvedValue([]),
    mockPut: vi.fn().mockResolvedValue(undefined),
    mockConfirm: vi.fn().mockResolvedValue(true),
    mockShowToast: vi.fn(),
  };
});

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    deleteAllEmbeddings: (...args: unknown[]) => mockDeleteAllEmbeddings(...args),
    deleteAllSummaries: (...args: unknown[]) => mockDeleteAllSummaries(...args),
    deleteLocalStoreRecordsByStores: (...args: unknown[]) => mockDeleteLocalStoreRecordsByStores(...args),
    updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
  },
}));

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn().mockResolvedValue({
    objectStoreNames: ['aiPortrait', 'aiBeliefs', 'aiChatMemory', 'documents'],
    clear: (...args: unknown[]) => mockClear(...args),
    getAll: (...args: unknown[]) => mockGetAll(...args),
    put: (...args: unknown[]) => mockPut(...args),
    transaction: vi.fn(() => {
      const store = {
        getAll: async () => mockGetAll('documents'),
        put: async (row: unknown) => mockPut('documents', row),
      };
      return { store, objectStore: () => store, done: Promise.resolve() };
    }),
  }),
}));

vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
  }),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

const profileState = vi.hoisted(() => ({
  profile: { aiConsentAt: new Date().toISOString() as string | null, aiConsentVersion: 1 as number | null },
  refreshProfile: vi.fn(async () => {}),
}));

vi.mock('../../../auth/contexts/ProfileContext', () => ({
  useProfile: () => profileState,
}));

vi.mock('../../../../core/ai/indexingConsent', () => ({
  getIndexingConsent: () => 'granted',
  setIndexingConsent: vi.fn(),
  INDEXING_CONSENT_VERSION: 1,
}));

describe('AccountAISection — «Удалить все данные ИИ» (WT-2, S-16)', () => {
  const userId = 'test_user_ai_cleanup';

  beforeEach(() => {
    vi.clearAllMocks();
    executionLog.length = 0;
    mockConfirm.mockResolvedValue(true);
    mockDeleteAllEmbeddings.mockImplementation(async () => {
      executionLog.push('deleteAllEmbeddings');
    });
    mockDeleteAllSummaries.mockImplementation(async () => {
      executionLog.push('deleteAllSummaries');
    });
    mockDeleteLocalStoreRecordsByStores.mockImplementation(async () => {
      executionLog.push('deleteLocalStoreRecordsByStores');
    });
    mockUpdateProfile.mockImplementation(async () => {
      executionLog.push('updateProfile');
    });
    mockClear.mockImplementation(async () => {
      executionLog.push('db.clear');
    });
  });

  it('1. Order: calls server deletions before the first local IndexedDB clear', async () => {
    renderWithProviders(<AccountAISection userId={userId} />);

    const clearButton = screen.getByRole('button', { name: /Удалить все данные ИИ/i });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringMatching(/Все данные ИИ удалены|settings_ai_data_cleared/),
        'success'
      );
    });

    expect(mockDeleteAllEmbeddings).toHaveBeenCalledWith(userId);
    expect(mockDeleteAllSummaries).toHaveBeenCalledWith(userId);
    expect(mockDeleteLocalStoreRecordsByStores).toHaveBeenCalledWith(userId, [...SUPPORTED_LOCAL_STORES]);
    expect(mockUpdateProfile).toHaveBeenCalledWith(userId, { aiPortrait: null });

    // Assert that every server call finished before local db.clear was invoked
    const firstClear = executionLog.indexOf('db.clear');
    expect(firstClear).toBeGreaterThan(-1);

    expect(executionLog.indexOf('deleteAllEmbeddings')).toBeLessThan(firstClear);
    expect(executionLog.indexOf('deleteAllSummaries')).toBeLessThan(firstClear);
    expect(executionLog.indexOf('deleteLocalStoreRecordsByStores')).toBeLessThan(firstClear);
    expect(executionLog.indexOf('updateProfile')).toBeLessThan(firstClear);
  });

  it('2. Server failure is not success: server rejection aborts local clear and shows error toast', async () => {
    mockDeleteAllEmbeddings.mockRejectedValueOnce(new Error('Server error: 503 Service Unavailable'));

    renderWithProviders(<AccountAISection userId={userId} />);

    const clearButton = screen.getByRole('button', { name: /Удалить все данные ИИ/i });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringMatching(/Не удалось очистить данные ИИ|settings_ai_data_clear_failed/),
        'error'
      );
    });

    expect(mockShowToast).not.toHaveBeenCalledWith(
      expect.stringMatching(/Все данные ИИ удалены|settings_ai_data_cleared/),
      'success'
    );
    // Crucial: no local store should have been touched when server delete failed
    expect(mockClear).not.toHaveBeenCalled();
    expect(executionLog).not.toContain('db.clear');
  });

  it('3. Stores list: deleteLocalStoreRecordsByStores receives exact SUPPORTED_LOCAL_STORES', async () => {
    renderWithProviders(<AccountAISection userId={userId} />);

    const clearButton = screen.getByRole('button', { name: /Удалить все данные ИИ/i });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(mockDeleteLocalStoreRecordsByStores).toHaveBeenCalledWith(
        userId,
        [...SUPPORTED_LOCAL_STORES]
      );
    });
  });
});

describe('AccountAISection — portrait-in-dialogue switch (backlog-ideas-2026-09-11)', () => {
  const userId = 'test_user_portrait_toggle';

  beforeEach(() => {
    localStorage.clear();
    usePortraitDialoguePreferenceStore.setState({ values: {} });
  });

  it('defaults to on, and a click writes the preference the AI hook actually reads', () => {
    renderWithProviders(<AccountAISection userId={userId} />);

    const toggle = screen.getByRole('switch', { name: /Отправлять портрет в диалог/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(getSendPortraitInDialogue(userId)).toBe(true);

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(getSendPortraitInDialogue(userId)).toBe(false);
  });
});

describe('AccountAISection — статус согласия после клика (GT Н-1)', () => {
  const userId = 'test_user_consent_status';
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    mockUpdateProfile.mockResolvedValue(undefined);
  });

  it('после «Предоставить согласие» профиль перечитывается — после записи', async () => {
    profileState.profile = { aiConsentAt: null, aiConsentVersion: null };
    const order: string[] = [];
    mockUpdateProfile.mockImplementation(async () => { order.push('update'); });
    profileState.refreshProfile.mockImplementation(async () => { order.push('refresh'); });
    renderWithProviders(<AccountAISection userId={userId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Предоставить согласие' }));
    await waitFor(() => expect(order).toEqual(['update', 'refresh']));
  });

  it('после отзыва согласия профиль тоже перечитывается', async () => {
    profileState.profile = { aiConsentAt: new Date().toISOString(), aiConsentVersion: 99 };
    const order: string[] = [];
    mockUpdateProfile.mockImplementation(async () => { order.push('update'); });
    profileState.refreshProfile.mockImplementation(async () => { order.push('refresh'); });
    renderWithProviders(<AccountAISection userId={userId} />);
    fireEvent.click(screen.getByRole('button', { name: /Отозвать согласие/i }));
    await waitFor(() => expect(order).toEqual(['update', 'refresh']));
  });

  it('запись не прошла — профиль не перечитывается, тост ошибки', async () => {
    profileState.profile = { aiConsentAt: null, aiConsentVersion: null };
    mockUpdateProfile.mockRejectedValue(new Error('network'));
    renderWithProviders(<AccountAISection userId={userId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Предоставить согласие' }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expect(profileState.refreshProfile).not.toHaveBeenCalled();
  });
});
