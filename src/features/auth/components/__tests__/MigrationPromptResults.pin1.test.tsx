// PIN-1 (дейлик 20.11, «держит, но не закреплено»): окно переноса гостевых заметок в аккаунт —
// итог назван своим типом. Мутации (каждая красит свой кейс):
//  left>0 → warning «перенесено не всё»      — игнорировать left в handleMigrate
//  failed>0 → error «в облако пока не ушло»   — игнорировать failed после syncAllUnlinked
//  inProgress → error (заметки не в облаке)    — убрать `inProgress ? moved : failedRaw`
//  бросок синхронизации → error                — убрать showToast в catch migrateCloudSync
//  бросок переноса → error + onDone(0, N)      — убрать showToast/onDone в внешнем catch
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({
  showToast: vi.fn(),
  migrateDocuments: vi.fn(),
  syncAllUnlinked: vi.fn(),
  cloudSyncOn: true,
}));

vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: h.showToast }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => h.cloudSyncOn }));
vi.mock('../../services/migrateDocuments', () => ({ migrateDocuments: (...a: unknown[]) => h.migrateDocuments(...a), readGuestDraft: vi.fn() }));
vi.mock('../../../../core/services/SyncService', () => ({ SyncService: { syncAllUnlinked: (...a: unknown[]) => h.syncAllUnlinked(...a) } }));
vi.mock('../../../../core/services/LocalDocumentService', () => ({ LocalDocumentService: { getDocumentsByOwner: vi.fn(async () => []) } }));
vi.mock('../../../../core/storage/localDb', () => ({ getOrCreateGuestId: () => 'guest_pin1', getLocalDb: vi.fn() }));

import { MigrationPrompt } from '../MigrationPrompt';

async function migrate() {
  const onDone = vi.fn();
  const onCloudSynced = vi.fn();
  render(<MigrationPrompt userId="u_pin1" docCount={3} onDone={onDone} onCloudSynced={onCloudSynced} />);
  fireEvent.click(screen.getByRole('button', { name: 'migration_move_to_account' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  return { onDone, onCloudSynced };
}

describe('PIN-1: MigrationPrompt — итог переноса', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); h.cloudSyncOn = true; });

  it('перенесено не всё (left>0) — warning, onDone с остатком, в облако не идём', async () => {
    h.migrateDocuments.mockResolvedValue({ moved: 2, left: 1 });
    const { onDone } = await migrate();
    expect(h.showToast).toHaveBeenCalledWith(expect.stringContaining('migration_partial'), 'warning');
    expect(onDone).toHaveBeenCalledWith({ moved: 2, left: 1 });
    expect(h.syncAllUnlinked).not.toHaveBeenCalled();
  });

  it('в облако ушло не всё (failed>0) — error с числом', async () => {
    h.migrateDocuments.mockResolvedValue({ moved: 3, left: 0 });
    h.syncAllUnlinked.mockResolvedValue({ synced: 1, failed: 2 });
    const { onCloudSynced } = await migrate();
    expect(h.showToast).toHaveBeenCalledWith(expect.stringContaining('"count":2'), 'error');
    expect(h.showToast).toHaveBeenCalledWith(expect.stringContaining('migration_cloud_pending'), 'error');
    expect(onCloudSynced).toHaveBeenCalledWith(1);
  });

  it('другая синхронизация уже шла (inProgress) — error: перенесённые заметки пока не в облаке', async () => {
    h.migrateDocuments.mockResolvedValue({ moved: 3, left: 0 });
    h.syncAllUnlinked.mockResolvedValue({ synced: 0, failed: 0, inProgress: true });
    await migrate();
    expect(h.showToast).toHaveBeenCalledWith(expect.stringContaining('"count":3'), 'error');
  });

  it('бросок синхронизации — error «что-то пошло не так», перенос завершён', async () => {
    h.migrateDocuments.mockResolvedValue({ moved: 3, left: 0 });
    h.syncAllUnlinked.mockRejectedValue(new Error('MARKER_PIN1_CLOUD'));
    const { onDone } = await migrate();
    expect(h.showToast).toHaveBeenCalledWith('error_generic_action', 'error');
    expect(onDone).toHaveBeenCalledWith({ moved: 3, left: 0 });
  });

  it('бросок переноса — error и onDone(moved 0, left = все)', async () => {
    h.migrateDocuments.mockRejectedValue(new Error('MARKER_PIN1_MIGRATE'));
    const { onDone } = await migrate();
    expect(h.showToast).toHaveBeenCalledWith('error_generic_action', 'error');
    expect(onDone).toHaveBeenCalledWith({ moved: 0, left: 3 });
  });

  it('КОНТРОЛЬ: всё ушло — без тостов ошибки', async () => {
    h.migrateDocuments.mockResolvedValue({ moved: 3, left: 0 });
    h.syncAllUnlinked.mockResolvedValue({ synced: 3, failed: 0 });
    const { onDone } = await migrate();
    expect(h.showToast).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({ moved: 3, left: 0 });
  });
});
