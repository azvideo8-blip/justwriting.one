// NB-4 (sus01): заметка из чата сохранена, но задача синка в очередь не встала —
// предупреждение «сохранено на устройстве, в облако позже», а не «успешно создана».
// Мутация: снова глотать отказ addToQueue и показывать success → красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNoteActions } from '../noteActions';
import { StorageService } from '../../../../../core/services/StorageService';
import { SyncService } from '../../../../../core/services/SyncService';
import * as domainEvents from '../../../../../core/events/domainEvents';

vi.mock('../../../../../core/services/StorageService', () => ({
  StorageService: { saveNew: vi.fn(), saveVersion: vi.fn() },
}));
vi.mock('../../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { getDocument: vi.fn() },
}));
vi.mock('../../../../../core/services/SyncService', () => ({
  SyncService: { addToQueue: vi.fn(), syncOne: vi.fn() },
}));

describe('NB-4 sus01: queue refusal is not «created successfully»', () => {
  const showToast = vi.fn();
  const t = (k: string) => k;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(domainEvents, 'emitDomainEvent');
    vi.mocked(StorageService.saveNew).mockResolvedValue({ localId: 'local_sus01' });
    vi.mocked(SyncService.syncOne).mockResolvedValue('cloud_sus01' as never);
  });

  // Ревью выпуска 0.11.24: прямая выгрузка — второй шанс и при отказе очереди, как
  // при импорте. Мутация: syncOne только при queued — красный.
  it('addToQueue отказал → warning, успеха нет, прямая выгрузка всё равно запущена', async () => {
    vi.mocked(SyncService.addToQueue).mockRejectedValue(new Error('IDB down'));
    const actions = createNoteActions({ userId: 'u_sus01', showToast, t });
    await actions.handleCreateNote('Синтетический ответ ИИ');
    expect(StorageService.saveNew).toHaveBeenCalled();
    expect(domainEvents.emitDomainEvent).toHaveBeenCalledWith({ type: 'note.saved', documentId: 'local_sus01', userId: 'u_sus01' });
    expect(showToast).toHaveBeenCalledWith('save_local_only_queued', 'warning');
    expect(showToast).not.toHaveBeenCalledWith('Заметка успешно создана', 'success');
    expect(SyncService.syncOne).toHaveBeenCalledWith('u_sus01', 'local_sus01');
    errSpy.mockRestore();
  });

  it('контроль: очередь встала, syncOne отказал → успех (задача в очереди)', async () => {
    vi.mocked(SyncService.addToQueue).mockResolvedValue(undefined as never);
    vi.mocked(SyncService.syncOne).mockRejectedValue(new Error('Network'));
    const actions = createNoteActions({ userId: 'u_sus01', showToast, t });
    await actions.handleCreateNote('Синтетический ответ ИИ');
    expect(showToast).toHaveBeenCalledWith('Заметка успешно создана', 'success');
    expect(showToast).not.toHaveBeenCalledWith('save_local_only_queued', 'warning');
    errSpy.mockRestore();
  });

  it('контроль: гость — очереди нет, успех без предупреждения', async () => {
    const actions = createNoteActions({ userId: 'guest_sus01', showToast, t });
    await actions.handleCreateNote('Синтетический ответ ИИ');
    expect(showToast).toHaveBeenCalledWith('Заметка успешно создана', 'success');
    expect(SyncService.addToQueue).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});