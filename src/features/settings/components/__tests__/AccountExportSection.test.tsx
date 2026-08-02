import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { AccountExportSection } from '../AccountExportSection';

vi.mock('../../services/migrationExport', () => ({
  exportMigrationManifest: vi.fn(),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: null }),
}));

vi.mock('../../../../core/services/UnifiedSessionLoader', () => ({
  loadAllSessions: vi.fn().mockResolvedValue([]),
  hydrateSessionContent: vi.fn().mockResolvedValue([]),
}));

vi.mock('file-saver', () => ({
  saveAs: vi.fn(),
}));

const { exportMigrationManifest } = await import('../../services/migrationExport');
const mockedExport = vi.mocked(exportMigrationManifest);

function makeManifest(skipped: { store: string; id: string; reason: string }[]) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    documents: [],
    drafts: [],
    aiSummaries: [],
    aiEmbeddings: [],
    verbatim: [],
    counters: {
      documents: 0,
      versions: 0,
      drafts: 0,
      aiSummaries: 0,
      aiEmbeddings: 0,
      verbatim: {},
    },
    checksums: {},
    skipped,
  };
}

describe('AccountExportSection — migration export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clicking migration export button calls exportMigrationManifest', async () => {
    mockedExport.mockResolvedValue(makeManifest([]));
    renderWithProviders(<AccountExportSection userId="u1" />);

    const btn = screen.getByTestId('migration-export-btn');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockedExport).toHaveBeenCalledTimes(1);
    });
  });

  it('shows skipped warning when skipped is non-empty', async () => {
    mockedExport.mockResolvedValue(makeManifest([
      { store: 'aiDialogues', id: 'd1', reason: 'read error' },
    ]));
    renderWithProviders(<AccountExportSection userId="u1" />);

    const btn = screen.getByTestId('migration-export-btn');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/Пропущено записей|Skipped records/)).toBeInTheDocument();
    });
  });

  it('does not show skipped warning when skipped is empty', async () => {
    mockedExport.mockResolvedValue(makeManifest([]));
    renderWithProviders(<AccountExportSection userId="u1" />);

    const btn = screen.getByTestId('migration-export-btn');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockedExport).toHaveBeenCalled();
    });
    expect(screen.queryByText(/Пропущено записей|Skipped records/)).not.toBeInTheDocument();
  });
});
