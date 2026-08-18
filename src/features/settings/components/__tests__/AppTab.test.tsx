import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../../../test/utils/render";
import { ThemeProvider } from "../../../../core/theme/ThemeProvider";
import { AppTab } from "../AppTab";
import { SyncService } from "../../../../core/services/SyncService";

vi.mock("../../../../core/services/SyncService", () => ({
  SyncService: {
    syncAllUnlinked: vi.fn(),
  },
}));

let mockSyncStatus = {
  status: "synced",
  pendingCount: 0,
  unsyncedCount: 0,
  autoSyncEnabled: true,
};

vi.mock("../../hooks/useSyncStatus", () => ({
  useSyncStatus: () => mockSyncStatus,
}));

vi.mock("../../../../shared/components/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../../../app/useAuthStatus", () => ({
  useAuthStatus: () => ({
    isAuthenticated: true,
    isGuest: false,
    user: { uid: "u1" },
  }),
}));

const mockedSyncAll = vi.mocked(SyncService.syncAllUnlinked);

describe("AppTab — C7 sync UI and sync all unlinked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("auto_sync_enabled", "true");
  });

  it("renders unsynced warning and sync all button when unsyncedCount > 0", () => {
    mockSyncStatus = {
      status: "unsynced",
      pendingCount: 0,
      unsyncedCount: 4,
      autoSyncEnabled: true,
    };

    renderWithProviders(
      <ThemeProvider>
        <AppTab userId="u1" />
      </ThemeProvider>
    );

    expect(screen.getByText(/Не синхронизировано заметок: 4|Unsynced documents: 4/)).toBeInTheDocument();
    const btn = screen.getByTestId("sync-all-unlinked-btn");
    expect(btn).toBeInTheDocument();
  });

  it("clicking sync all button calls SyncService.syncAllUnlinked", async () => {
    mockSyncStatus = {
      status: "unsynced",
      pendingCount: 0,
      unsyncedCount: 4,
      autoSyncEnabled: true,
    };
    mockedSyncAll.mockResolvedValue({ synced: 4, failed: 0 });

    renderWithProviders(
      <ThemeProvider>
        <AppTab userId="u1" />
      </ThemeProvider>
    );

    const btn = screen.getByTestId("sync-all-unlinked-btn");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockedSyncAll).toHaveBeenCalledWith("u1");
    });
  });
});
