import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNoteActions } from '../noteActions';
import { StorageService } from '../../../../../core/services/StorageService';
import { SyncService } from '../../../../../core/services/SyncService';
import * as domainEvents from '../../../../../core/events/domainEvents';

vi.mock('../../../../../core/services/StorageService', () => ({
  StorageService: {
    saveNew: vi.fn(),
    saveVersion: vi.fn(),
  },
}));

vi.mock('../../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    getDocument: vi.fn(),
  },
}));

vi.mock('../../../../../core/services/SyncService', () => ({
  SyncService: {
    addToQueue: vi.fn().mockResolvedValue(undefined),
    syncOne: vi.fn().mockResolvedValue('cloud_123'),
  },
}));

describe('createNoteActions', () => {
  const showToast = vi.fn();
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    emitSpy = vi.spyOn(domainEvents, 'emitDomainEvent');
  });

  describe('handleCreateNote', () => {
    it('creates note, notifies user, emits domain event, and enqueues sync for auth user', async () => {
      vi.mocked(StorageService.saveNew).mockResolvedValue({ localId: 'local_abc' });
      const actions = createNoteActions({ userId: 'u_test_1', showToast });

      await actions.handleCreateNote('<p>Заголовок новой заметки\nВторая строка текста</p>');

      expect(StorageService.saveNew).toHaveBeenCalledWith(
        'u_test_1',
        expect.objectContaining({
          title: 'Заголовок новой заметки',
          content: 'Заголовок новой заметки\nВторая строка текста',
          tags: ['ИИ'],
        })
      );
      expect(showToast).toHaveBeenCalledWith('Заметка успешно создана', 'success');
      expect(emitSpy).toHaveBeenCalledWith({
        type: 'note.saved',
        documentId: 'local_abc',
        userId: 'u_test_1',
      });
      expect(SyncService.addToQueue).toHaveBeenCalledWith('local_abc');
      expect(SyncService.syncOne).toHaveBeenCalledWith('u_test_1', 'local_abc');
    });

    it('does not enqueue or sync when user is guest', async () => {
      vi.mocked(StorageService.saveNew).mockResolvedValue({ localId: 'local_guest' });
      const actions = createNoteActions({ userId: 'guest_999', showToast });

      await actions.handleCreateNote('Заметка гостя');

      expect(StorageService.saveNew).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith({
        type: 'note.saved',
        documentId: 'local_guest',
        userId: 'guest_999',
      });
      expect(SyncService.addToQueue).not.toHaveBeenCalled();
      expect(SyncService.syncOne).not.toHaveBeenCalled();
    });

    it('shows success toast even if cloud sync fails (task remains in queue)', async () => {
      vi.mocked(StorageService.saveNew).mockResolvedValue({ localId: 'local_fail' });
      vi.mocked(SyncService.syncOne).mockRejectedValue(new Error('Network error'));
      const actions = createNoteActions({ userId: 'u_test_1', showToast });

      await actions.handleCreateNote('Тестовая заметка');

      expect(SyncService.addToQueue).toHaveBeenCalledWith('local_fail');
      expect(SyncService.syncOne).toHaveBeenCalledWith('u_test_1', 'local_fail');
      expect(showToast).toHaveBeenCalledWith('Заметка успешно создана', 'success');
    });
  });

});
