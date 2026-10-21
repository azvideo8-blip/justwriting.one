// D-2: сбой облака не должен давать молчаливую неполную GDPR-выгрузку.
// Путь настоящий: реальный loadAllSessions (UnifiedSessionLoader) поверх
// моков только по краям — IndexedDB, DocumentService (облако) и скачивание.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, cleanup, renderHook } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { AccountExportSection } from '../AccountExportSection';
import { useProfileStats } from '../../../profile/hooks/useProfileStats';

const mocks = vi.hoisted(() => ({
  getDocuments: vi.fn(),
  showToast: vi.fn(),
  downloadBlob: vi.fn(),
  exportAllAsZip: vi.fn(),
}));

vi.mock('../../../../core/storage/localDb', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getLocalDb: vi.fn(async () => ({ getAll: async () => [] })) };
});
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { getDocumentsByOwner: vi.fn(async () => []) },
}));
vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: { getUserDocuments: (...a: unknown[]) => mocks.getDocuments(...a) },
}));
vi.mock('../../../../core/services/ExportAllService', () => ({
  exportAllAsZip: (...a: unknown[]) => mocks.exportAllAsZip(...a),
}));
vi.mock('../../../../shared/utils/downloadBlob', () => ({
  downloadBlob: (...a: unknown[]) => mocks.downloadBlob(...a),
}));
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u1' }, profile: null }),
}));
// hydrate — отдельный платный проход; сбой облака наступает раньше, а в
// успешном сценарии список уже содержит тексты.
vi.mock('../../../../core/services/UnifiedSessionLoader', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../core/services/UnifiedSessionLoader')>();
  return { ...actual, hydrateSessionContent: vi.fn(async (sessions: unknown[]) => sessions) };
});

const CLOUD_DOC = {
  id: 'cloud-1',
  userId: 'u1',
  currentVersion: 1,
  totalWords: 3,
  totalDuration: 1000,
  sessionsCount: 1,
  firstSessionAt: new Date('2026-10-01T10:00:00Z'),
  lastSessionAt: new Date('2026-10-01T10:00:00Z'),
  title: 'MARKER_D2_CLOUD',
  tags: [],
};

describe('D-2: экспорт при сбое облака', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exportAllAsZip.mockResolvedValue({ exported: 1, skipped: 0 });
  });
  afterEach(cleanup);

  it('ZIP: облако не прочиталось — нет скачивания и тоста успеха, есть ошибка', async () => {
    mocks.getDocuments.mockRejectedValue(new Error('MARKER_D2_CLOUD'));
    renderWithProviders(<AccountExportSection userId="u1" />);

    fireEvent.click(screen.getByRole('button', { name: /Экспортировать всё в ZIP/ }));

    await waitFor(() => expect(screen.getByText(/Облако не прочиталось/)).toBeTruthy());
    expect(mocks.exportAllAsZip).not.toHaveBeenCalled();
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringMatching(/Экспортировано/), 'success');
  });

  it('ревью 0.10.7: облако не прочиталось — можно явно выгрузить только с устройства', async () => {
    mocks.getDocuments.mockRejectedValue(new Error('MARKER_D2_CLOUD'));
    renderWithProviders(<AccountExportSection userId="u1" />);

    fireEvent.click(screen.getByRole('button', { name: /Экспортировать всё в ZIP/ }));
    await waitFor(() => expect(screen.getByText(/Облако не прочиталось/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Только с этого устройства/ }));

    // На устройстве в этом тесте пусто: гейт облака пройден, дошли до проверки списка.
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Нет заметок для экспорта', 'error'));
  });

  it('JSON: облако не прочиталось — файл не скачивается', async () => {
    mocks.getDocuments.mockRejectedValue(new Error('MARKER_D2_CLOUD'));
    renderWithProviders(<AccountExportSection userId="u1" />);

    fireEvent.click(screen.getByRole('button', { name: /Скачать заметки в JSON/ }));

    await waitFor(() => expect(screen.getByText(/Облако не прочиталось/)).toBeTruthy());
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringMatching(/Экспортировано/), 'success');
  });

  it('ZIP: облако ок — экспорт идёт как раньше', async () => {
    mocks.getDocuments.mockResolvedValue([CLOUD_DOC]);
    renderWithProviders(<AccountExportSection userId="u1" />);

    fireEvent.click(screen.getByRole('button', { name: /Экспортировать всё в ZIP/ }));

    await waitFor(() => expect(mocks.exportAllAsZip).toHaveBeenCalledTimes(1));
    expect(mocks.exportAllAsZip.mock.calls[0]![0]).toHaveLength(1);
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringMatching(/Экспортировано/), 'success');
    expect(screen.queryByText(/Облако не прочиталось/)).toBeNull();
  });

  it('профиль: сбой облака выставляет cloudLoadFailed, а не молчит', async () => {
    mocks.getDocuments.mockRejectedValue(new Error('MARKER_D2_CLOUD'));
    const { result } = renderHook(() => useProfileStats('d2-user', { uid: 'd2-user' } as never));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cloudLoadFailed).toBe(true);
  });

  it('пусто только при успешном чтении облака', async () => {
    mocks.getDocuments.mockResolvedValue([]);
    renderWithProviders(<AccountExportSection userId="u1" />);

    fireEvent.click(screen.getByRole('button', { name: /Экспортировать всё в ZIP/ }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Нет заметок для экспорта', 'error'));
    expect(mocks.exportAllAsZip).not.toHaveBeenCalled();
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });
});
