// EX-5 (PIN-1, итог импорта): статусы выгрузки после импорта переноса — «сейф заперт»
// и «ошибка отправки» — видны предупреждением, а не молча. Компонент настоящий;
// моки — края (импорт-сервис, тост, auth). Харнесс — из AccountExportSection.test.
// Мутации: убрать строку vault_locked / failed — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { AccountExportSection } from '../AccountExportSection';

vi.mock('../../services/migrationExport', () => ({ exportMigrationManifest: vi.fn() }));
vi.mock('../../services/migrationImport', () => ({ importMigrationManifest: vi.fn() }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u1' }, profile: { encryptionMeta: { version: 1 } } }),
}));
vi.mock('../../../../core/services/UnifiedSessionLoader', () => ({
  loadAllSessions: vi.fn().mockResolvedValue({ sessions: [], cloudLoadFailed: false }),
  hydrateSessionContent: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../../shared/utils/downloadBlob', () => ({ downloadBlob: vi.fn() }));

const { importMigrationManifest } = await import('../../services/migrationImport');
const mockedImport = vi.mocked(importMigrationManifest);

function importResult(upload: unknown) {
  return {
    success: true,
    imported: { documents: 3, versions: 5, drafts: 1, aiSummaries: 0, aiEmbeddings: 0, verbatim: {} },
    skipped: { documents: 0, versions: 0, drafts: 0, aiSummaries: 0, aiEmbeddings: 0, verbatim: {}, details: [] },
    droppedOnPurpose: { peopleIndexRecords: 0, summariesWithMentionedPeople: 0, unknownStores: {}, verbatimDenied: {} },
    upload,
  } as never;
}

async function runImport(upload: unknown) {
  mockedImport.mockResolvedValue(importResult(upload));
  renderWithProviders(<AccountExportSection userId="u1" />);
  const fileInput = screen.getByTestId('migration-import-file-input');
  fireEvent.change(fileInput, { target: { files: [new File(['{"version": 1}'], 'export.json', { type: 'application/json' })] } });
  await waitFor(() => expect(mockedImport).toHaveBeenCalled());
}

describe('EX-5: итог импорта — статусы выгрузки видны', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('сейф заперт: строка предупреждения с числом заметок в очереди', async () => {
    await runImport({ status: 'vault_locked', attempted: 0, uploaded: 0, queued: 3 });
    const row = await screen.findByText(/Сейф заперт: 3 заметок/);
    expect(row.className).toContain('text-accent-warning');
  });

  it('ошибка отправки в облако: строка предупреждения с причиной и очередью', async () => {
    await runImport({ status: 'failed', attempted: 3, uploaded: 0, queued: 3, reason: 'Network down' });
    const row = await screen.findByText(/Ошибка отправки в облако \(Network down\): 3 заметок/);
    expect(row.className).toContain('text-accent-warning');
  });

  it('контроль: выгрузка прошла — строк предупреждения нет', async () => {
    await runImport({ status: 'completed', attempted: 3, uploaded: 3, queued: 0 });
    await screen.findByText(/Импортировано: 3 заметок|Imported: 3 documents/);
    expect(screen.queryByText(/Сейф заперт/)).toBeNull();
    expect(screen.queryByText(/Ошибка отправки в облако/)).toBeNull();
  });
});
