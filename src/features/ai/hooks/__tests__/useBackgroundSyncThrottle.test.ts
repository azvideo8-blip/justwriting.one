// AUD-13: троттлинг фонового восстановления ставился глобально и до успеха —
// упавший проход заставлял человека ждать сутки до повторной попытки, а ключ
// был общим для всех аккаунтов браузера. Теперь ключ по uid и ставится только
// после полного прохода. Фальсификация: вернуть старый ключ/раннюю установку.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBackgroundSync } from '../useBackgroundSync';

const mockRestore = vi.fn();
const mockRestoreAi = vi.fn();

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'u_throttle_1' }),
}));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

vi.mock('../../services/AIRestoreService', () => ({
  restoreAIDataFromCloud: (...a: unknown[]) => mockRestoreAi(...a),
  reattachOrphanedAnalysis: vi.fn().mockResolvedValue(undefined),
  // В-1: фоновый проход зовёт продолжение догрузки; без этого экспорта в моке
  // Vitest падает на обращении к нему и до восстановления заметок не доходит.
  continueEmbeddingDownload: vi.fn().mockResolvedValue({ embeddings: 0, failed: 0, markedSynced: 0, finished: false }),
}));

vi.mock('../../services/AIEmbeddingService', () => ({
  AIEmbeddingService: { syncPendingToCloud: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../../core/services/CloudSyncService', () => ({
  CloudSyncService: { restoreMissingDocuments: (...a: unknown[]) => mockRestore(...a) },
}));

vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: { syncPending: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: {
    retryOversizedRecords: vi.fn(),
    flushPending: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: { getState: () => ({ addActivity: vi.fn() }) },
}));

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({
  cloudSyncEnabled: () => true,
}));

describe('AUD-13 restore throttle is per-account and only after success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Гарантируем setTimeout-путь: sinon fake timers не управляют настоящим
    // requestIdleCallback, если он есть в окружении.
    Reflect.deleteProperty(window, 'requestIdleCallback');
    localStorage.clear();
    mockRestoreAi.mockResolvedValue({ skippedLocked: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not set the notes throttle key when the notes pass fails', async () => {
    mockRestore.mockRejectedValue(new Error('offline'));

    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);

    expect(mockRestore).toHaveBeenCalled();
    expect(localStorage.getItem('notes_restore_done_date_u_throttle_1')).toBeNull();
  });

  // Журнал владельца 30.10: упавший полный проход ИИ-данных (десятки МБ) шёл
  // заново каждые 120 с. Теперь пауза 30 минут. Мутация: убрать проверку
  // retryAfter → красный (второй полный проход через 2 минуты).
  it('после неудачного полного прохода ИИ-данных следующий — не раньше чем через 30 минут', async () => {
    mockRestore.mockResolvedValue({ restored: 0, hasMore: false });
    mockRestoreAi.mockResolvedValue({ skippedLocked: false, sectionFailed: true, failed: 0 });
    const fullCalls = () => mockRestoreAi.mock.calls.filter(c => c[1] === undefined).length;

    // Каждый монтаж — отдельный проход (в этих подменах повтор по опросу не идёт).
    const first = renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);
    first.unmount();
    expect(fullCalls()).toBe(1);
    const retryAfter = Number(localStorage.getItem('ai_restore_retry_after_u_throttle_1'));
    expect(retryAfter - Date.now(), 'пауза не выставлена').toBeGreaterThan(29 * 60_000);

    const second = renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);
    second.unmount();
    expect(fullCalls(), 'полный проход повторился внутри паузы').toBe(1);

    localStorage.setItem('ai_restore_retry_after_u_throttle_1', String(Date.now() - 1));
    const third = renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);
    third.unmount();
    expect(fullCalls(), 'после паузы попытка снова идёт').toBe(2);
  });

  // Дейлик 30.10 Н-4 (DY10-4): C2 разделил отметки и потерял страж «сейф заперт».
  // Проход до ввода пароля ставил отметку «заметки на сегодня восстановлены» —
  // после разблокировки автоматика молчала до полуночи. Мутация: убрать
  // `&& !locked` → красный.
  it('запертый сейф не ставит отметку восстановления заметок', async () => {
    mockRestore.mockResolvedValue({ restored: 0, hasMore: false, locked: true });

    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);

    expect(mockRestore).toHaveBeenCalled();
    expect(localStorage.getItem('notes_restore_done_date_u_throttle_1')).toBeNull();
  });

  // C2: битый ряд в облаке держит `hasMore` (неполный список) сутками. С общей
  // отметкой полный restoreAIDataFromCloud шёл каждый проход. Мутация: вернуть
  // общую отметку (ИИ-ключ только при полных заметках) → красный.
  it('C2: incomplete notes list does not repeat the full AI pass every cycle', async () => {
    mockRestore.mockResolvedValue({ restored: 0, hasMore: true });
    mockRestoreAi.mockResolvedValue({ skippedLocked: false, failed: 0, sectionFailed: false });

    // Три прохода — три монтирования (как открытие приложения заново за день).
    for (let i = 0; i < 3; i++) {
      const h = renderHook(() => useBackgroundSync());
      await vi.advanceTimersByTimeAsync(5_100);
      h.unmount();
    }

    const fullAiPasses = mockRestoreAi.mock.calls.filter(c => c.length === 1 || c[1] === undefined).length;
    expect(mockRestore.mock.calls.length, 'заметки повторяются своим чередом').toBeGreaterThan(1);
    expect(fullAiPasses, 'полный проход ИИ — один раз за сутки').toBe(1);
    expect(localStorage.getItem('notes_restore_done_date_u_throttle_1')).toBeNull();
  });

  it('keys the throttle by account and sets it after a full pass', async () => {
    mockRestore.mockResolvedValue({ restored: 2, hasMore: false });

    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);

    expect(localStorage.getItem('ai_restore_done_date_u_throttle_1'))
      .toBe(new Date().toISOString().slice(0, 10));
  });

  // R-8: отпущенный осиротевший head возвращает failed=0 → отметка стоит, и
  // следующий проход зовёт только инкрементальный забор (с sinceMs), не полный.
  it('R-8: after a clean pass the next pass does not call the full restore again', async () => {
    mockRestore.mockResolvedValue({ restored: 0, hasMore: false });
    mockRestoreAi.mockResolvedValue({ skippedLocked: false, failed: 0, sectionFailed: false });

    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);
    expect(localStorage.getItem('ai_restore_done_date_u_throttle_1')).toBe(new Date().toISOString().slice(0, 10));
    expect(mockRestore).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120_000 + 5_100);
    expect(mockRestore, 'полный проход за день — один').toHaveBeenCalledTimes(1);
    const fullCalls = mockRestoreAi.mock.calls.filter(c => c[1] === undefined);
    expect(fullCalls, 'restoreAIDataFromCloud без sinceMs — один раз').toHaveLength(1);
  });

  it('F-024: does not set the throttle key when aiRestored has failed > 0', async () => {
    mockRestore.mockResolvedValue({ restored: 2, hasMore: false });
    mockRestoreAi.mockResolvedValue({ skippedLocked: false, failed: 1, sectionFailed: false });

    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);

    expect(mockRestore).toHaveBeenCalled();
    expect(localStorage.getItem('ai_restore_done_date_u_throttle_1')).toBeNull();
  });

  it('F-024: does not set the throttle key when aiRestored has sectionFailed === true', async () => {
    mockRestore.mockResolvedValue({ restored: 2, hasMore: false });
    mockRestoreAi.mockResolvedValue({ skippedLocked: false, failed: 0, sectionFailed: true });

    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);

    expect(mockRestore).toHaveBeenCalled();
    expect(localStorage.getItem('ai_restore_done_date_u_throttle_1')).toBeNull();
  });
});
