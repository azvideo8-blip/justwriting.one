// NB-5 (sus15): импорт — отказ очереди назван. importNoteFile отдаёт
// queued:false, вызывающий показывает warning «сохранено на устройстве»,
// а не зелёный успех (образец — NB-4). Успех в вызывающем идёт через
// reportMutationResult — сырых тостов успеха не прибавляется.
// Мутация: убрать queued=false в catch addToQueue (снова глотать отказ) —
// красный; откат — зелёный.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const saveNewMock = vi.hoisted(() => vi.fn());
const addToQueueMock = vi.hoisted(() => vi.fn());
const syncOneMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/services/LocalStorageService', () => ({
  LocalStorageService: { saveNew: (...a: unknown[]) => saveNewMock(...a) },
}));
vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    addToQueue: (...a: unknown[]) => addToQueueMock(...a),
    syncOne: (...a: unknown[]) => syncOneMock(...a),
  },
}));

import { importNoteFile, importFilesWithFeedback } from '../archiveImport';

const showToast = vi.fn();
const onImported = vi.fn();
const t = (key: string, params?: Record<string, string | number>) =>
  params?.count !== undefined ? `${key}(${params.count})` : key;

function makeFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' });
}

function deps() {
  return { userId: 'user-1', isSignedIn: true, showToast, t, onImported };
}

beforeEach(() => {
  vi.clearAllMocks();
  saveNewMock.mockResolvedValue({ localId: 'local-1' });
  addToQueueMock.mockResolvedValue(undefined);
  syncOneMock.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('NB-5: импорт — отказ очереди назван', () => {
  // Ревью 0.11.24, Nit 3: отказ очереди не отменяет прямую выгрузку — это второй
  // шанс, как до NB-5. Мутация: syncOne только при queued — красный.
  it('addToQueue отказал — queued:false, заметка сохранена, прямая выгрузка всё равно запущена', async () => {
    addToQueueMock.mockRejectedValue(new Error('IDB down'));
    const res = await importNoteFile(makeFile('note.txt', 'синтетический текст'), 'user-1', true);
    expect(res.success).toBe(true);
    expect(res.queued).toBe(false);
    expect(saveNewMock).toHaveBeenCalled();
    await new Promise(r => setTimeout(r, 0));
    expect(syncOneMock).toHaveBeenCalledWith('user-1', 'local-1');
  });

  it('контроль: очередь приняла — queued:true, syncOne запущен', async () => {
    const res = await importNoteFile(makeFile('note.txt', 'синтетический текст'), 'user-1', true);
    expect(res.success).toBe(true);
    expect(res.queued).toBe(true);
    await new Promise(r => setTimeout(r, 0));
    expect(syncOneMock).toHaveBeenCalledWith('user-1', 'local-1');
  });

  it('гость: очереди нет — успех без облачного обещания', async () => {
    const res = await importNoteFile(makeFile('note.txt', 'синтетический текст'), 'guest', false);
    expect(res.success).toBe(true);
    expect(res.queued).not.toBe(false);
    expect(addToQueueMock).not.toHaveBeenCalled();
    expect(syncOneMock).not.toHaveBeenCalled();
  });

  it('вызывающий: очередь отказала — warning «на устройстве», зелёного успеха нет', async () => {
    addToQueueMock.mockRejectedValue(new Error('IDB down'));
    await importFilesWithFeedback([makeFile('note.txt', 'синтетический текст')], deps());
    expect(showToast).toHaveBeenCalledWith('archive_import_local_only(1)', 'warning');
    expect(showToast.mock.calls.some(c => c[1] === 'success' || c[1] === undefined)).toBe(false);
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('вызывающий контроль: всё в очереди — успех, warning нет', async () => {
    await importFilesWithFeedback([makeFile('note.txt', 'синтетический текст')], deps());
    expect(showToast).toHaveBeenCalledWith('archive_import_success(1)', 'success');
    expect(showToast.mock.calls.some(c => String(c[0]).startsWith('archive_import_local_only'))).toBe(false);
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('вызывающий: два файла, один без очереди — успех за один и warning за один', async () => {
    addToQueueMock.mockRejectedValueOnce(new Error('IDB down')).mockResolvedValue(undefined);
    await importFilesWithFeedback([makeFile('a.txt', 'один'), makeFile('b.txt', 'два')], deps());
    expect(showToast).toHaveBeenCalledWith('archive_import_success(1)', 'success');
    expect(showToast).toHaveBeenCalledWith('archive_import_local_only(1)', 'warning');
  });

  it('вызывающий: файл не импортирован — ошибка, успеха нет', async () => {
    await importFilesWithFeedback([makeFile('image.png', 'binary')], deps());
    expect(showToast).toHaveBeenCalledWith('archive_import_failed(1)', 'error');
    expect(showToast.mock.calls.some(c => c[1] === 'success')).toBe(false);
    expect(onImported).not.toHaveBeenCalled();
  });
});