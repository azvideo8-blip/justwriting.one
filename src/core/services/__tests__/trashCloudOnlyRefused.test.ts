// Находка Fable 19.11: заметка только с облачной копией (без локальной). Облако
// отказало — в очередь класть нечего, ничего не изменилось, а оба входа (список
// архива и меню строки) говорили «Удалено на этом устройстве, отправится позже».
// То же у восстановления из корзины. Отказ без локальной копии — это бросок:
// вызывающие уже показывают ошибку и не трогают список.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { StorageService } from '../StorageService';
import { DocumentService } from '../DocumentService';

vi.mock('../DocumentService', () => ({
  DocumentService: {
    trashDocument: vi.fn(),
    restoreDocument: vi.fn(),
  },
}));

const userId = 'u_trash_cloud_only';

describe('корзина заметки только с облачной копией', () => {
  beforeEach(() => vi.clearAllMocks());

  it('облако отказало при удалении в корзину — бросок, а не «отправится позже»', async () => {
    vi.mocked(DocumentService.trashDocument).mockRejectedValue(new Error('unavailable'));
    await expect(StorageService.trashDocument(userId, undefined, 'cloud-1')).rejects.toThrow('unavailable');
  });

  it('облако отказало при восстановлении — бросок, а не «восстановлено»', async () => {
    vi.mocked(DocumentService.restoreDocument).mockRejectedValue(new Error('unavailable'));
    await expect(StorageService.restoreDocument(userId, undefined, 'cloud-1')).rejects.toThrow('unavailable');
  });

  it('облако приняло — успех, как раньше', async () => {
    vi.mocked(DocumentService.trashDocument).mockResolvedValue(undefined as never);
    await expect(StorageService.trashDocument(userId, undefined, 'cloud-1')).resolves.toEqual({ cloudSynced: true });
  });
});
