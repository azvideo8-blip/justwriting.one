import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, renderHook, waitFor } from "@testing-library/react";
import "fake-indexeddb/auto";
import { SyncConsentModal, useSyncConsentCheck } from "../SyncConsentModal";
import { STORAGE_KEYS } from "../../../../shared/constants/storageKeys";
import { SyncService } from "../../../../core/services/SyncService";
import { getLocalDb } from "../../../../core/storage/localDb";
import * as authStatusModule from "../../../../features/auth/hooks/useAuthStatus";
import { cloudSyncEnabled, setCloudSyncEnabled } from "../../../../core/sync/cloudSyncEnabled";

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
    const syncSpy = vi.spyOn(SyncService, "syncPending").mockResolvedValue({ drained: 0, failed: 0 });

    render(<SyncConsentModal onClose={onClose} userId="u_sync_123" />);

    const enableBtn = screen.getByText("sync_consent_enable");
    fireEvent.click(enableBtn);

    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED("u_sync_123"))).toBe("true");
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ASKED("u_sync_123"))).toBe("true");
    expect(syncSpy).toHaveBeenCalledWith("u_sync_123");
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking 'Leave it off' sets AUTO_SYNC_ENABLED=false and AUTO_SYNC_ASKED=true", () => {
    const onClose = vi.fn();
    const syncSpy = vi.spyOn(SyncService, "syncPending");

    render(<SyncConsentModal onClose={onClose} userId="u_sync_123" />);

    const keepOffBtn = screen.getByText("sync_consent_keep_off");
    fireEvent.click(keepOffBtn);

    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED("u_sync_123"))).toBe("false");
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ASKED("u_sync_123"))).toBe("true");
    expect(syncSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("useSyncConsentCheck: shows consent modal for signed-in user with local notes and no prior keys", async () => {
    vi.spyOn(authStatusModule, "useAuthStatus").mockReturnValue({
      user: { uid: "user_456" } as never,
      profile: null, refreshProfile: async () => {},
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
      profile: null, refreshProfile: async () => {},
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
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED("user_456"), "false");

    vi.spyOn(authStatusModule, "useAuthStatus").mockReturnValue({
      user: { uid: "user_456" } as never,
      profile: null, refreshProfile: async () => {},
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
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ASKED("user_456"), "true");

    vi.spyOn(authStatusModule, "useAuthStatus").mockReturnValue({
      user: { uid: "user_456" } as never,
      profile: null, refreshProfile: async () => {},
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

  it("useSyncConsentCheck: DOES show consent modal for new account even if local docs count is 0 (D-22)", async () => {
    vi.spyOn(authStatusModule, "useAuthStatus").mockReturnValue({
      user: { uid: "user_456" } as never,
      profile: null, refreshProfile: async () => {},
      authState: "authenticated" as never,
      isAuthenticated: true,
      isGuest: false,
      loading: false,
      isConnected: false,
    });

    const { result } = renderHook(() => useSyncConsentCheck());

    await waitFor(() => {
      expect(result.current.showConsent).toBe(true);
    });
  });

  it("LS-2 multi-account isolation: user A consents, user B is asked, A remains enabled, B disabled", async () => {
    // 1. User A signs in and has local docs
    const authSpy = vi.spyOn(authStatusModule, "useAuthStatus").mockReturnValue({
      user: { uid: "user_A" } as never,
      profile: null, refreshProfile: async () => {},
      authState: "authenticated" as never,
      isAuthenticated: true,
      isGuest: false,
      loading: false,
      isConnected: false,
    });

    const db = await getLocalDb();
    await db.put("documents", { id: "doc_A", guestId: "user_A", title: "Note A" } as never);

    const { result: checkA } = renderHook(() => useSyncConsentCheck());
    await waitFor(() => {
      expect(checkA.current.showConsent).toBe(true);
    });

    // User A turns sync on
    const onCloseA = vi.fn();
    render(<SyncConsentModal onClose={onCloseA} userId="user_A" />);
    fireEvent.click(screen.getByText("sync_consent_enable"));

    expect(cloudSyncEnabled("user_A")).toBe(true);

    // 2. User A signs out, User B signs in and has local docs
    await db.put("documents", { id: "doc_B", guestId: "user_B", title: "Note B" } as never);

    authSpy.mockReturnValue({
      user: { uid: "user_B" } as never,
      profile: null, refreshProfile: async () => {},
      authState: "authenticated" as never,
      isAuthenticated: true,
      isGuest: false,
      loading: false,
      isConnected: false,
    });

    const { result: checkB } = renderHook(() => useSyncConsentCheck());
    await waitFor(() => {
      expect(checkB.current.showConsent).toBe(true);
    });

    expect(cloudSyncEnabled("user_B")).toBe(false);
    expect(cloudSyncEnabled("user_A")).toBe(true);
  });

  it("LS-2 legacy migration: legacy keys migrate to user A, are cleared, user B is still asked", async () => {
    localStorage.setItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ENABLED, "true");
    localStorage.setItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ASKED, "true");

    const authSpy = vi.spyOn(authStatusModule, "useAuthStatus").mockReturnValue({
      user: { uid: "user_A" } as never,
      profile: null, refreshProfile: async () => {},
      authState: "authenticated" as never,
      isAuthenticated: true,
      isGuest: false,
      loading: false,
      isConnected: false,
    });

    const db = await getLocalDb();
    await db.put("documents", { id: "doc_A2", guestId: "user_A", title: "Note A2" } as never);

    const { result: checkA } = renderHook(() => useSyncConsentCheck());
    // Since legacy was already enabled & asked, migration marks user_A as asked and enabled, so modal is not shown
    await waitFor(() => {
      expect(checkA.current.showConsent).toBe(false);
    });

    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED("user_A"))).toBe("true");
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ASKED("user_A"))).toBe("true");
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ENABLED)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ASKED)).toBeNull();

    // Now user B signs in with local docs
    await db.put("documents", { id: "doc_B2", guestId: "user_B", title: "Note B2" } as never);

    authSpy.mockReturnValue({
      user: { uid: "user_B" } as never,
      profile: null, refreshProfile: async () => {},
      authState: "authenticated" as never,
      isAuthenticated: true,
      isGuest: false,
      loading: false,
      isConnected: false,
    });

    const { result: checkB } = renderHook(() => useSyncConsentCheck());
    await waitFor(() => {
      expect(checkB.current.showConsent).toBe(true);
    });
    expect(cloudSyncEnabled("user_B")).toBe(false);
  });

  // Тот же случай для вопроса о синхронизации: мастер ответил на него на шаге 3,
  // окно после мастера всплывать не должно.
  it("useSyncConsentCheck: stays quiet during the invite wizard and honours its answer afterwards", async () => {
    vi.spyOn(authStatusModule, "useAuthStatus").mockReturnValue({
      user: { uid: "user_wiz" } as never,
      profile: null, refreshProfile: async () => {},
      authState: "authenticated" as never,
      isAuthenticated: true,
      isGuest: false,
      loading: false,
      isConnected: false,
    });
    const { result, rerender } = renderHook(({ suspended }) => useSyncConsentCheck(suspended), {
      initialProps: { suspended: true },
    });
    await new Promise(r => setTimeout(r, 20));
    expect(result.current.showConsent).toBe(false);

    setCloudSyncEnabled("user_wiz", false); // «Не сейчас» на шаге 3
    rerender({ suspended: false });
    await new Promise(r => setTimeout(r, 20));
    expect(result.current.showConsent).toBe(false);
  });

  it("Escape closes the window without recording an answer, so it is asked again later", () => {
    const onClose = vi.fn();
    render(<SyncConsentModal onClose={onClose} userId="u_esc" />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ASKED("u_esc"))).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED("u_esc"))).toBeNull();
  });
});
