import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { AccountExportSection } from '../AccountExportSection';

vi.mock('../../services/migrationExport', () => ({
  exportMigrationManifest: vi.fn(),
}));

vi.mock('../../services/migrationImport', () => ({
  importMigrationManifest: vi.fn(),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

let mockProfile: { encryptionMeta?: unknown; encryptionSalt?: string; encryptedDataKey?: string } | null = null;
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u1' }, profile: mockProfile }),
}));

vi.mock('../../../../core/services/UnifiedSessionLoader', () => ({
  loadAllSessions: vi.fn().mockResolvedValue({ sessions: [], cloudLoadFailed: false }),
  hydrateSessionContent: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../shared/utils/downloadBlob', () => ({
  downloadBlob: vi.fn(),
}));

const { exportMigrationManifest } = await import('../../services/migrationExport');
const { importMigrationManifest } = await import('../../services/migrationImport');
const mockedExport = vi.mocked(exportMigrationManifest);
const mockedImport = vi.mocked(importMigrationManifest);

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

describe('AccountExportSection — migration export & import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile = null;
  });

  it('clicking migration export button calls exportMigrationManifest and saves with justwriting-backup filename (D-21)', async () => {
    const { downloadBlob } = await import('../../../../shared/utils/downloadBlob');
    mockedExport.mockResolvedValue(makeManifest([]));
    renderWithProviders(<AccountExportSection userId="u1" />);

    const btn = screen.getByTestId('migration-export-btn');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockedExport).toHaveBeenCalledTimes(1);
      expect(downloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringMatching(/^justwriting-backup-\d{4}-\d{2}-\d{2}\.json$/)
      );
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

  it('disables import button and displays warning when no vault exists', () => {
    mockProfile = null;
    renderWithProviders(<AccountExportSection userId="u1" />);

    const importBtn = screen.getByTestId('migration-import-btn');
    expect(importBtn).toBeDisabled();
    expect(screen.getByText(/Сейф ещё не создан|No vault exists yet/)).toBeInTheDocument();
  });

  it('enables import button when vault exists', () => {
    mockProfile = { encryptionMeta: { version: 1 } };
    renderWithProviders(<AccountExportSection userId="u1" />);

    const importBtn = screen.getByTestId('migration-import-btn');
    expect(importBtn).not.toBeDisabled();
    expect(screen.queryByText(/Сейф ещё не создан|No vault exists yet/)).not.toBeInTheDocument();
  });

  it('calls importMigrationManifest when file is selected', async () => {
    mockProfile = { encryptionMeta: { version: 1 } };
    mockedImport.mockResolvedValue({
      success: true,
      imported: { documents: 3, versions: 5, drafts: 1, aiSummaries: 2, aiEmbeddings: 2, verbatim: { aiDialogues: 1 } },
      skipped: { documents: 0, versions: 0, drafts: 0, aiSummaries: 0, aiEmbeddings: 0, verbatim: {}, details: [] },
      droppedOnPurpose: { peopleIndexRecords: 0, summariesWithMentionedPeople: 0, unknownStores: {}, verbatimDenied: {} },
    });

    renderWithProviders(<AccountExportSection userId="u1" />);

    const fileInput = screen.getByTestId('migration-import-file-input');
    const fakeFile = new File(['{"version": 1}'], 'export.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    await waitFor(() => {
      expect(mockedImport).toHaveBeenCalledWith({ version: 1 }, 'u1');
    });

    await waitFor(() => {
      expect(screen.getByText(/Импортировано: 3 заметок|Imported: 3 documents/)).toBeInTheDocument();
    });
  });
});

