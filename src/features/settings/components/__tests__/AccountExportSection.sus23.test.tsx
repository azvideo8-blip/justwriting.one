// NB-15 (sus23): импорт переноса — версия с нешедшейся контрольной суммой
// пропущена (текст потерян), красная панель есть, но тост итога зелёный.
// Путь настоящий: реальный importMigrationManifest поверх fake-indexeddb,
// моки только края (тост, auth, флаг синхронизации — sync_off без сети).
// Мутация: вернуть тип success при повреждённых версиях — красный а.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { AccountExportSection } from '../AccountExportSection';
import { resetDbInstance } from '../../../../core/storage/localDb';
import type { MigrationManifest } from '../../services/migrationExport';

const showToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u1' }, profile: null }),
}));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const ver = (id: string, content: string) => ({
  id, version: 1, content, wordCount: 2, wordsAdded: 2, charsAdded: content.length,
  duration: 10, wpm: 60, savedAt: 1000, sessionStartedAt: 1000,
});

async function manifestWith(badChecksum: boolean): Promise<MigrationManifest> {
  const good = 'Синтетический текст версии';
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    documents: [{
      localId: 'doc_sus23', uuid: 'uuid-sus23', title: 'Синтетика',
      currentVersion: 1, totalWords: 4, totalDuration: 10, sessionsCount: 1,
      firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
      versions: [ver('ver_ok', good), ver('ver_bad', 'Испорченный текст')],
    }],
    drafts: [], aiSummaries: [], aiEmbeddings: [], verbatim: [],
    checksums: {
      ver_ok: await sha256Hex(good),
      ver_bad: badChecksum ? '0'.repeat(64) : await sha256Hex('Испорченный текст'),
    },
    counters: { documents: 1, versions: 2, verbatim: 0 },
    skipped: [],
  } as unknown as MigrationManifest;
}

async function importFile(manifest: MigrationManifest) {
  const file = new File([JSON.stringify(manifest)], 'backup.json', { type: 'application/json' });
  fireEvent.change(screen.getByTestId('migration-import-file-input'), { target: { files: [file] } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetDbInstance();
  localStorage.clear();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('justwriting-local-u1');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});
afterEach(cleanup);

describe('NB-15: повреждённая версия при импорте — итог не зелёный', () => {
  it('а) checksum mismatch — warning и красная панель потери', async () => {
    renderWithProviders(<AccountExportSection userId="u1" />);
    await importFile(await manifestWith(true));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Импортировано'), 'warning'));
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('Импортировано'), 'success');
    expect(await screen.findByText(/ПОВРЕЖДЕНО и не перенесено: 1/)).toBeTruthy();
  });

  it('контроль: все суммы сошлись — зелёный итог как раньше', async () => {
    renderWithProviders(<AccountExportSection userId="u1" />);
    await importFile(await manifestWith(false));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Импортировано'), 'success'));
    expect(screen.queryByText(/ПОВРЕЖДЕНО/)).toBeNull();
  });

  it('PIN-1: файл переноса не читается как JSON — error-тост, не зелёный итог', async () => {
    renderWithProviders(<AccountExportSection userId="u1" />);
    const file = new File(['{это не json'], 'backup.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('migration-import-file-input'), { target: { files: [file] } });

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('Что-то пошло не так. Попробуй ещё раз.', 'error');
    });
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('Импортировано'), 'success');
  });
});