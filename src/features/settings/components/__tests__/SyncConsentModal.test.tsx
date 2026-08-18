import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, renderHook, waitFor } from "@testing-library/react";
import "fake-indexeddb/auto";
import { SyncConsentModal, useSyncConsentCheck } from "../SyncConsentModal";
import { STORAGE_KEYS } from "../../../../shared/constants/storageKeys";
import { SyncService } from "../../../../core/services/SyncService";
import { getLocalDb } from "../../../../core/storage/localDb";
import * as authStatusModule from "../../../../features/auth/hooks/useAuthStatus";

vi.mock("../../../../shared/i18n", () => ({
  useLanguage: () => ({
    t: (k: string) => k,
  }),
}));

vi.mock("../../../../core/services/SyncService", () => ({
  SyncService: {
    syncPending: vi.fn(),
  },
}));

describe("D4.25 SyncConsentModal & useSyncConsentCheck", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    const db = await getLocalDb();
    const all = await db.getAll("documents");
    for (const d of all) await db.delete("documents", d.id);
  });

  it("clicking 'Turn sync on' sets AUTO_SYNC_ENABLED=true and AUTO_SYNC_ASKED=true and syncs pending", () => {
    const onClose = vi.fn();
    const syncSpy = vi.spyOn(SyncService, "syncPending").mockResolvedValue();

    render(<SyncConsentModal onClose={onClose} userId="u_sync_123" />);

    const enableBtn = screen.getByText("sync_consent_enable");
    fireEvent.click(enableBtn);

    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED)).toBe("true");
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ASKED)).toBe("true");
    expect(syncSpy).toHaveBeenCalledWith("u_sync_123");
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking 'Leave it off' sets AUTO_SYNC_ENABLED=false and AUTO_SYNC_ASKED=true", () => {
    const onClose = vi.fn();
    const syncSpy = vi.spyOn(SyncService, "syncPending");

    render(<SyncConsentModal onClose={onClose} userId="u_sync_123" />);

    const keepOffBtn = screen.getByText("sync_consent_keep_off");
    fireEvent.click(keepOffBtn);

    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED)).toBe("false");
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ASKED)).toBe("true");
    expect(syncSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("useSyncConsentCheck: shows consent modal for signed-in user with local notes and no prior keys", async () => {
    vi.spyOn(authStatusModule, "useAuthStatus").mockReturnValue({
      user: { uid: "user_456" } as never,
      profile: null,
      authState: "authenticated" as never,
      isAuthenticated: true,
      isGuest: false,
      loading: false,
      isConnected: false,
    });

    const db = await getLocalDb();
    await db.put("documents", { id: "doc1", guestId: "user_456", title: "Note 1" } as never);

    const { result } = renderHook(() => useSyncConsentCheck());

    await waitFor(() => {
      expect(result.current.showConsent).toBe(true);
    });
  });

  it("useSyncConsentCheck: does NOT show consent modal for guests", async () => {
    vi.spyOn(authStatusModule, "useAuthStatus").mockReturnValue({
      user: { uid: "guest_789" } as never,
      profile: null,
      authState: "authenticated" as never,
      isAuthenticated: true,
      isGuest: true,
      loading: false,
      isConnected: false,
    });

    const db = await getLocalDb();
    await db.put("documents", { id: "doc1", guestId: "guest_789", title: "Note 1" } as never);

    const { result } = renderHook(() => useSyncConsentCheck());

    await waitFor(() => {
      expect(result.current.showConsent).toBe(false);
    });
  });

  it("useSyncConsentCheck: does NOT show consent modal if AUTO_SYNC_ENABLED is already present", async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED, "false");

    vi.spyOn(authStatusModule, "useAuthStatus").mockReturnValue({
      user: { uid: "user_456" } as never,
      profile: null,
      authState: "authenticated" as never,
      isAuthenticated: true,
      isGuest: false,
      loading: false,
      isConnected: false,
    });

    const db = await getLocalDb();
    await db.put("documents", { id: "doc1", guestId: "user_456", title: "Note 1" } as never);

    const { result } = renderHook(() => useSyncConsentCheck());

    await waitFor(() => {
      expect(result.current.showConsent).toBe(false);
    });
  });

  it("useSyncConsentCheck: does NOT show consent modal if AUTO_SYNC_ASKED is already present", async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ASKED, "true");

    vi.spyOn(authStatusModule, "useAuthStatus").mockReturnValue({
      user: { uid: "user_456" } as never,
      profile: null,
      authState: "authenticated" as never,
      isAuthenticated: true,
      isGuest: false,
      loading: false,
      isConnected: false,
    });

    const db = await getLocalDb();
    await db.put("documents", { id: "doc1", guestId: "user_456", title: "Note 1" } as never);

    const { result } = renderHook(() => useSyncConsentCheck());

    await waitFor(() => {
      expect(result.current.showConsent).toBe(false);
    });
  });

  it("useSyncConsentCheck: does NOT show consent modal if local docs count is 0", async () => {
    vi.spyOn(authStatusModule, "useAuthStatus").mockReturnValue({
      user: { uid: "user_456" } as never,
      profile: null,
      authState: "authenticated" as never,
      isAuthenticated: true,
      isGuest: false,
      loading: false,
      isConnected: false,
    });

    const { result } = renderHook(() => useSyncConsentCheck());

    await waitFor(() => {
      expect(result.current.showConsent).toBe(false);
    });
  });
});
