import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLocalDb, resetDbInstance, processPendingPurges } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

// S-28 (O-5): удаление аккаунта стирает с этого устройства и гостевую базу
// `justwriting-local` — заметки, которые человек решил оставить локально, её
// черновик и производные ИИ.

const USER = 'user_s28_wipe';
const GUEST_ID = 'guest_s28';

let mockCurrentUser: { uid: string; email: string } | null = null;

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => mockCurrentUser,
  getCurrentUserId: () => mockCurrentUser?.uid ?? null,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOutUser: vi.fn(async () => { mockCurrentUser = null; }),
  sendPasswordResetEmail: vi.fn(),
  reauthenticate: vi.fn(async () => {}),
}));
vi.mock('../../../core/ai/callAi', () => ({ callAi: vi.fn(async () => ({ success: true })) }));

async function dropDatabases(): Promise<void> {
  resetDbInstance();
  for (const name of ['justwriting-local', `justwriting-local-${USER}`]) {
    await new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
}

async function seedGuestData(): Promise<void> {
  const docId = await LocalDocumentService.createDocument(GUEST_ID, { title: 'Заметка, оставленная локально', tags: [] });
  await LocalVersionService.addVersion(GUEST_ID, docId, {
    content: 'Текст оставленной заметки',
    previousContent: '',
    wordCount: 4,
    duration: 30,
    wpm: 8,
    versionNumber: 1,
    sessionStartedAt: new Date(),
  });
  const guest = await getLocalDb('justwriting-local');
  await guest.put('drafts', { userId: GUEST_ID, title: 'Черновик гостя', content: 'Текст черновика', updatedAt: Date.now() } as never);
  await guest.put('aiDialogues', { id: 'dlg_guest', title: 'Диалог гостя', personaId: 'coach', messages: [], createdAt: 1, updatedAt: 1 } as never);
  localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({ content: 'Черновик в localStorage' }));
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mockCurrentUser = { uid: USER, email: 'someone@example.com' };
  await dropDatabases();
});

describe('S-28: account deletion wipes this browser’s guest data', () => {
  it('deleteAccount leaves no documents, drafts, versions or AI stores in justwriting-local', async () => {
    await seedGuestData();
    const { AuthService } = await import('../services/AuthService');

    await AuthService.deleteAccount('secretPassword');

    const guest = await getLocalDb('justwriting-local');
    expect(await guest.getAll('documents'), 'гостевая заметка пережила удаление аккаунта').toEqual([]);
    expect(await guest.getAll('versions')).toEqual([]);
    expect(await guest.getAll('drafts')).toEqual([]);
    expect(await guest.getAll('aiDialogues'), 'AI-стор гостя пережил удаление аккаунта').toEqual([]);
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).toBeNull();
  });

  it('the pending-purge marker finishes the guest wipe too', async () => {
    await seedGuestData();
    localStorage.setItem(`jw_pending_purge_${USER}`, '1');
    // S-32: старт после удаления — сессии этого uid на устройстве уже нет.
    mockCurrentUser = null;

    await processPendingPurges();

    const guest = await getLocalDb('justwriting-local');
    expect(await guest.getAll('documents')).toEqual([]);
    expect(await guest.getAll('aiDialogues')).toEqual([]);
    expect(localStorage.getItem(`jw_pending_purge_${USER}`)).toBeNull();
  });
});
