// BR-9 (ревью 25.10, класс RA1-1). `addToSyncQueue(documentId, ownerId)`
// резолвит базу через `getCurrentUser()`, если владельца не передали: в окне
// восстановления сессии это гостевая база `justwriting-local`. RA1-1 закрыл
// один вызов; остались ещё двое — заметка из ответа ИИ (`noteActions.ts:35`) и
// `queueMetadataRetry` в архиве (`archiveCrud.ts:20,24`), где и флаг метаданных
// ставился в чужую базу.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../../../core/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/auth')>();
  return { ...actual, getCurrentUser: () => null };
});

vi.mock('../../../../core/services/DocumentService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/services/DocumentService')>();
  return {
    DocumentService: {
      ...actual.DocumentService,
      updateTags: vi.fn().mockRejectedValue(new Error('cloud unavailable')),
    },
  };
});

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { createNoteActions } from '../../../ai/components/chat/noteActions';
import { updateArchiveField } from '../archiveCrud';
import { LocalStorageService } from '../../../../core/services/LocalStorageService';
import { getLocalDb } from '../../../../core/storage/localDb';
import type { AppUser } from '../../../../core/auth/types';
import type { ArchiveSession } from '../../types';

const userId = `u_br9_${Date.now()}`;

async function queueDocIds(owner: string | null): Promise<string[]> {
  const db = await getLocalDb(owner ?? undefined);
  if (!db.objectStoreNames.contains('syncQueue')) return [];
  const all = await db.getAll('syncQueue');
  return all.filter(t => t.type === 'document').map(t => t.documentId as string);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('BR-9: очередь метаданных и заметка из ответа ИИ — в базе аккаунта', () => {
  it('заметка из ответа ИИ: задача в базе аккаунта, в гостевой — пусто', async () => {
    const actions = createNoteActions({ userId, showToast: vi.fn(), t: (k: string) => k });
    await actions.handleCreateNote('Синтетическая заметка из ответа ассистента');

    const guest = await queueDocIds(null);
    const account = await queueDocIds(userId);
    expect(account.length, 'задача не в базе аккаунта').toBeGreaterThan(0);
    expect(guest, 'задача уехала в гостевую базу').toHaveLength(0);
  });

  it('правка метаданных в архиве без облака: задача и флаг — в базе аккаунта', async () => {
    const { localId } = await LocalStorageService.saveNew(userId, {
      title: 'Архивная заметка',
      content: 'Синтетический текст',
      wordCount: 2,
      duration: 30,
      wpm: 20,
      tags: [],
      sessionStartedAt: new Date(),
    });
    const session = {
      id: localId, userId, title: 'Архивная заметка', content: '', createdAt: Date.now(),
      duration: 30, wordCount: 2, charCount: 10, wpm: 20, tags: [],
      _isLocal: true, _linkedCloudId: 'cloud_br9',
    } as unknown as ArchiveSession;

    await updateArchiveField(session, 'tags', ['важное'], { uid: userId } as AppUser, userId);
    // `queueMetadataRetry` улетает fire-and-forget (void в .catch) — даём ему
    // дойти, иначе проверка читала бы очередь раньше постановки задачи.
    await new Promise(r => setTimeout(r, 20));

    const guest = await queueDocIds(null);
    expect(guest, 'задача retries уехала в гостевую базу').toHaveLength(0);
    expect(await queueDocIds(userId)).toContain(localId);
  });

  // Тот же класс, но про сами записи: правка метаданных без владельца
  // писалась в базу того, кто вошёл сейчас (линтер `no-restricted-syntax`
  // требует владельца в каждом локальном помощнике).
  it('теги правятся в базе аккаунта, а не в гостевой', async () => {
    const { localId } = await LocalStorageService.saveNew(userId, {
      title: 'Архивная заметка тегов',
      content: 'Синтетический текст',
      wordCount: 2,
      duration: 30,
      wpm: 20,
      tags: [],
      sessionStartedAt: new Date(),
    });
    const session = {
      id: localId, userId, title: 'Архивная заметка тегов', content: '', createdAt: Date.now(),
      duration: 30, wordCount: 2, charCount: 10, wpm: 20, tags: [],
      _isLocal: true,
    } as unknown as ArchiveSession;

    await updateArchiveField(session, 'tags', ['важное'], { uid: userId } as AppUser, userId);

    const accountDb = await getLocalDb(userId);
    const accountDoc = await accountDb.get('documents', localId);
    expect(accountDoc?.tags, 'теги не записаны в базу аккаунта').toEqual(['важное']);

    const guestDb = await getLocalDb();
    expect(await guestDb.get('documents', localId), 'та же заметка появилась в гостевой базе').toBeUndefined();
  });
});
