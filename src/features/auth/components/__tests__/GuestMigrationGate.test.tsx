import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { GuestMigrationGate } from '../GuestMigrationGate';
import { getLocalDb, getOrCreateGuestId } from '../../../../core/storage/localDb';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { SyncService } from '../../../../core/services/SyncService';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

let mockAuth = {
  user: null as { uid: string; email?: string } | null,
  isGuest: true,
};

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => mockAuth,
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      if (key === 'migration_move_to_account') return 'Перенести в аккаунт';
      if (key === 'migration_found_title') return 'Найдены локальные записи';
      return key;
    },
  }),
}));

const mockShowToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    syncAllUnlinked: vi.fn().mockResolvedValue({ synced: 1, failed: 0 }),
  },
}));

beforeEach(async () => {
  localStorage.clear();
  mockShowToast.mockClear();
  mockAuth = { user: null, isGuest: true };
  // Перенос кладёт заметки в базу аккаунта — чистим и её, иначе тесты видят друг друга.
  for (const uid of [undefined, 'user_new_123', 'user_sync_gate']) {
    const db = await getLocalDb(uid);
    const tx = db.transaction(['drafts', 'documents', 'versions'], 'readwrite');
    await Promise.all([
      tx.objectStore('drafts').clear(),
      tx.objectStore('documents').clear(),
      tx.objectStore('versions').clear(),
    ]);
    await tx.done;
  }
});

describe('GuestMigrationGate', () => {
  it('does not render when user is guest', async () => {
    const guestId = getOrCreateGuestId();
    await LocalDocumentService.createDocument(guestId, { title: 'Guest Title' });

    const { container } = render(<GuestMigrationGate />);
    expect(container.firstChild).toBeNull();
  });

  it('detects guest documents on login and performs migration upon approval', async () => {
    const guestId = getOrCreateGuestId();
    await LocalDocumentService.createDocument(guestId, { title: 'Guest Title 1' });
    await LocalDocumentService.createDocument(guestId, { title: 'Guest Title 2' });

    const { rerender } = render(<GuestMigrationGate />);

    // User logs in:
    mockAuth = { user: { uid: 'user_new_123' }, isGuest: false };
    rerender(<GuestMigrationGate />);

    // MigrationPrompt should appear:
    const migrateBtn = await screen.findByText('Перенести в аккаунт');
    expect(migrateBtn).toBeTruthy();

    // Click migrate:
    fireEvent.click(migrateBtn);

    await waitFor(async () => {
      const userDocs = await LocalDocumentService.getDocumentsByOwner('user_new_123');
      expect(userDocs).toHaveLength(2);
    });

    // Check prompt is closed:
    await waitFor(() => {
      expect(screen.queryByText('Перенести в аккаунт')).toBeNull();
    });

    // Success toast shown:
    expect(mockShowToast).toHaveBeenCalled();
  });

  // EA-17: перенос в аккаунт — локальный; с выключенной синхронизацией
  // в облако не уходит ничего.
  it.each([
    ['off', false, 0],
    ['on', true, 1],
  ])('uploads migrated notes only when sync is %s', async (_label, syncOn, calls) => {
    vi.mocked(SyncService.syncAllUnlinked).mockClear();
    if (syncOn) localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('user_sync_gate'), 'true');
    await LocalDocumentService.createDocument(getOrCreateGuestId(), { title: 'Guest' });

    const { rerender } = render(<GuestMigrationGate />);
    mockAuth = { user: { uid: 'user_sync_gate' }, isGuest: false };
    rerender(<GuestMigrationGate />);
    fireEvent.click(await screen.findByText('Перенести в аккаунт'));

    await waitFor(async () => {
      expect(await LocalDocumentService.getDocumentsByOwner('user_sync_gate')).toHaveLength(1);
      expect(screen.queryByText('Перенести в аккаунт')).toBeNull();
    });
    expect(SyncService.syncAllUnlinked).toHaveBeenCalledTimes(calls);
  });

  it('sets MIGRATION_DECLINED only when user explicitly chooses to keep local', async () => {
    await LocalDocumentService.createDocument(getOrCreateGuestId(), { title: 'Guest Note' });
    const { rerender } = render(<GuestMigrationGate />);
    mockAuth = { user: { uid: 'user_decline' }, isGuest: false };
    rerender(<GuestMigrationGate />);

    const keepBtn = await screen.findByText('migration_keep_local');
    fireEvent.click(keepBtn);

    await waitFor(() => {
      expect(screen.queryByText('migration_keep_local')).toBeNull();
    });
    expect(localStorage.getItem(STORAGE_KEYS.MIGRATION_DECLINED('user_decline'))).toBe('1');
  });

  it('migrates draft-only with 0 notes and shows success toast without marking declined', async () => {
    const guestDb = await getLocalDb();
    await guestDb.put('drafts', {
      userId: 'guest_draft',
      content: 'Draft content',
      updatedAt: Date.now(),
    } as never);

    const { rerender } = render(<GuestMigrationGate />);
    mockAuth = { user: { uid: 'user_draft_only' }, isGuest: false };
    rerender(<GuestMigrationGate />);

    const migrateBtn = await screen.findByText('Перенести в аккаунт');
    fireEvent.click(migrateBtn);

    await waitFor(() => {
      expect(screen.queryByText('Перенести в аккаунт')).toBeNull();
    });

    expect(mockShowToast).toHaveBeenCalledWith('migration_success_local', 'success');
    expect(localStorage.getItem(STORAGE_KEYS.MIGRATION_DECLINED('user_draft_only'))).toBeNull();
  });
});
