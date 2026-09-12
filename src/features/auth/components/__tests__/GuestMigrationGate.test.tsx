import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { GuestMigrationGate } from '../GuestMigrationGate';
import { getLocalDb, getOrCreateGuestId } from '../../../../core/storage/localDb';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';

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
  const db = await getLocalDb();
  const tx = db.transaction(['drafts', 'documents', 'versions'], 'readwrite');
  await Promise.all([
    tx.objectStore('drafts').clear(),
    tx.objectStore('documents').clear(),
    tx.objectStore('versions').clear(),
  ]);
  await tx.done;
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
});
