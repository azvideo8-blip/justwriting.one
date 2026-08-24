import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSyncStatus } from "../useSyncStatus";
import { SyncService } from "../../../../core/services/SyncService";
import { STORAGE_KEYS } from "../../../../shared/constants/storageKeys";

vi.mock("../../../../core/services/SyncService", () => ({
  SyncService: {
    getPendingCount: vi.fn(),
    getUnsyncedCount: vi.fn(),
  },
}));

vi.mock("../../../../shared/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => true,
}));

const mockedPending = vi.mocked(SyncService.getPendingCount);
const mockedUnsynced = vi.mocked(SyncService.getUnsyncedCount);

describe("useSyncStatus — C7 sync status comparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED, "true");
  });

  it("reports synced when both pendingCount and unsyncedCount are 0", async () => {
    mockedPending.mockResolvedValue(0);
    mockedUnsynced.mockResolvedValue(0);

    const { result } = renderHook(() => useSyncStatus("u1"));

    await waitFor(() => {
      expect(result.current.status).toBe("synced");
      expect(result.current.unsyncedCount).toBe(0);
      expect(result.current.pendingCount).toBe(0);
    });
  });

  it("reports unsynced when local notes lack a cloud copy even with an empty queue", async () => {
    mockedPending.mockResolvedValue(0);
    mockedUnsynced.mockResolvedValue(5);

    const { result } = renderHook(() => useSyncStatus("u1"));

    await waitFor(() => {
      expect(result.current.status).toBe("unsynced");
      expect(result.current.unsyncedCount).toBe(5);
    });
  });
});

// AUD-25: вместо опроса IndexedDB каждые 10 секунд — подписка на события слоя
// синка. Фальсификация: вернуть setInterval — тест на отсутствие таймера и
// тест на событие краснеют.
describe("useSyncStatus — AUD-25 event-driven", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED, "true");
  });

  it("does not install a polling interval", async () => {
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    mockedPending.mockResolvedValue(0);
    mockedUnsynced.mockResolvedValue(0);

    renderHook(() => useSyncStatus("u1"));
    await waitFor(() => expect(mockedPending).toHaveBeenCalled());

    // Ни одного периодического таймера от хука (grace-таймеры — setTimeout).
    const intervals = intervalSpy.mock.calls.filter(([, ms]) => typeof ms === "number" && ms >= 1000);
    expect(intervals).toHaveLength(0);
    intervalSpy.mockRestore();
  });

  it("re-reads counts when the sync layer announces a queue change", async () => {
    mockedPending.mockResolvedValue(0);
    mockedUnsynced.mockResolvedValue(0);

    const { result } = renderHook(() => useSyncStatus("u1"));
    await waitFor(() => expect(mockedPending).toHaveBeenCalledTimes(1));

    mockedPending.mockResolvedValue(2);
    window.dispatchEvent(new CustomEvent("sync-queue-changed"));
    // Дебаунс перечёта 500 мс.
    await new Promise((r) => setTimeout(r, 700));
    await waitFor(() => {
      expect(result.current.pendingCount).toBe(2);
    });
  });
});
