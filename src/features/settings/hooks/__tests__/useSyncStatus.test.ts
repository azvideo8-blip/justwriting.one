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
