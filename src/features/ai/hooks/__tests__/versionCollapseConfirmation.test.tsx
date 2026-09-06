import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useDiagnosticsData } from '../useDiagnosticsData';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { LanguageProvider } from '../../../../shared/i18n';
import { adminTranslations } from '../../../../shared/i18n/translations/admin';

// Mocks for hooks used inside useDiagnosticsData
const mockShowToast = vi.fn();
const mockConfirmDialog = vi.fn();

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: mockConfirmDialog }),
}));

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'user_admin_test', isAnonymous: false }),
}));

vi.mock('../../../auth/hooks/useAdminStatus', () => ({
  useAdminStatus: () => ({ isAdmin: true, loading: false }),
}));

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockResolvedValue([]),
  }),
  getOrCreateGuestId: () => 'guest_fallback',
}));

describe('REG-4a: version collapse confirmation and partial cloud delete reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <LanguageProvider>{children}</LanguageProvider>
  );

  it('The confirmation text contains no claim that only local data is affected', async () => {
    vi.spyOn(LocalDocumentService, 'getDocumentsByOwner').mockResolvedValue([
      { id: 'doc_1' } as any,
      { id: 'doc_2' } as any,
    ]);
    vi.spyOn(LocalVersionService, 'countCollapsibleVersions').mockResolvedValue(5);
    mockConfirmDialog.mockResolvedValue(false); // User cancels, we just inspect the dialog prompt

    const { result } = renderHook(() => useDiagnosticsData(null, false, 'stats'), { wrapper });

    await act(async () => {
      await result.current.handleCollapseVersions();
    });

    expect(mockConfirmDialog).toHaveBeenCalledTimes(1);
    const dialogArgs = mockConfirmDialog.mock.calls[0]![0];

    // 1. Question title puts the count of versions to be deleted
    expect(dialogArgs.title).toContain('5');
    expect(dialogArgs.title).toMatch(/5/);

    // 2. Confirmation message contains NO claim that only local snapshots/data are affected
    expect(dialogArgs.message).not.toContain('удаляются лишь старые снимки');
    expect(dialogArgs.message).not.toContain('только локально');
    expect(dialogArgs.message).not.toContain('только на этом устройстве');

    // 3. Message explicitly states cloud deletion on all devices
    expect(dialogArgs.message).toContain('из облака на всех устройствах');

    // 4. Verify admin.ts confirmation translations also contain no claim of local-only deletion
    const ruConfirm = adminTranslations.admin_collapse_versions_confirm_message!.ru;
    const enConfirm = adminTranslations.admin_collapse_versions_confirm_message!.en;
    expect(ruConfirm).not.toContain('удаляются лишь старые снимки');
    expect(ruConfirm).toContain('из облака');
    expect(enConfirm).toContain('from the cloud');
  });

  it('Cloud delete rejects: the toast reports a partial collapse', async () => {
    vi.spyOn(LocalDocumentService, 'getDocumentsByOwner').mockResolvedValue([
      { id: 'doc_1' } as any,
    ]);
    vi.spyOn(LocalVersionService, 'countCollapsibleVersions').mockResolvedValue(2);
    mockConfirmDialog.mockResolvedValue(true);

    // Mock collapseToLatest returning a cloudError
    vi.spyOn(LocalVersionService, 'collapseToLatest').mockResolvedValue({
      removedCount: 2,
      deletedVersionNumbers: [1, 2],
      cloudError: new Error('Cloud storage unavailable'),
    });

    const { result } = renderHook(() => useDiagnosticsData(null, false, 'stats'), { wrapper });

    await act(async () => {
      await result.current.handleCollapseVersions();
    });

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    const [toastMessage, toastType] = mockShowToast.mock.calls[0]!;

    // Must report error type and describe partial collapse
    expect(toastType).toBe('error');
    expect(toastMessage.toLowerCase()).toMatch(/частично|partial/);
    expect(toastMessage.toLowerCase()).toMatch(/облак|cloud/);
  });

  it('Cloud delete succeeds: the toast reports done with count', async () => {
    vi.spyOn(LocalDocumentService, 'getDocumentsByOwner').mockResolvedValue([
      { id: 'doc_1' } as any,
    ]);
    vi.spyOn(LocalVersionService, 'countCollapsibleVersions').mockResolvedValue(3);
    mockConfirmDialog.mockResolvedValue(true);

    vi.spyOn(LocalVersionService, 'collapseToLatest').mockResolvedValue({
      removedCount: 3,
      deletedVersionNumbers: [1, 2, 3],
    });

    const { result } = renderHook(() => useDiagnosticsData(null, false, 'stats'), { wrapper });

    await act(async () => {
      await result.current.handleCollapseVersions();
    });

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    const [toastMessage, toastType] = mockShowToast.mock.calls[0]!;

    expect(toastType).toBe('success');
    expect(toastMessage).toContain('3');
  });
});
