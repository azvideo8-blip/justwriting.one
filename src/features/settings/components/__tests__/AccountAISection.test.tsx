import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { renderWithProviders } from '../../../../test/utils/render';
import { AccountAISection } from '../AccountAISection';
import { SUPPORTED_LOCAL_STORES } from '../../../../core/services/LocalStoreSyncService';

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

vi.mock('../../../auth/contexts/ProfileContext', () => ({
  useProfile: () => ({
    profile: {
      aiConsentAt: new Date().toISOString(),
      aiConsentVersion: 1,
    },
  }),
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
