import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import "fake-indexeddb/auto";
import { useAIChatContext } from "../../services/aiChatContext";
import { AIProfileService } from "../../services/AIProfileService";
import {
  setSendPortraitInDialogue,
  usePortraitDialoguePreferenceStore,
} from "../../../../core/ai/portraitDialoguePreference";

vi.mock("../../../../shared/errors/reportError", () => ({ reportError: vi.fn() }));

const TEST_UID = "u_portrait_test";
vi.mock("../../../../core/auth", () => ({
  getCurrentUser: () => ({ uid: TEST_UID }),
}));

const PORTRAIT_TEXT = "Пишет по вечерам, часто о работе и семье.";

// Backlog "de-personalised portrait", shape 1 (docs/backlog-ideas-2026-09-11.md):
// the switch must keep the portrait out of BOTH the reply the caller reads
// (ctx.userPortrait) AND the memory context (AIMemoryAssembler used to carry its
// own copy; it is gone since MB-10, the check stays).
describe("portrait-in-dialogue preference wiring", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    usePortraitDialoguePreferenceStore.setState({ values: {} });
    vi.spyOn(AIProfileService, "getPortrait").mockResolvedValue(PORTRAIT_TEXT);
  });

  it("sends the portrait when the preference is on (the default)", async () => {
    const { result } = renderHook(() => useAIChatContext("coach"));

    const ctx = await result.current.buildContext({
      text: "Привет",
      attached: null,
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
    });

    expect(ctx.userPortrait).toBe(PORTRAIT_TEXT);
  });

  it("keeps the portrait out of the reply and the memory assembler when the preference is off", async () => {
    setSendPortraitInDialogue(TEST_UID, false);

    const { result } = renderHook(() => useAIChatContext("coach"));

    const ctx = await result.current.buildContext({
      text: "Привет",
      attached: null,
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
    });

    expect(ctx.userPortrait).toBeFalsy();
    expect(ctx.memoryContext ?? '').not.toContain(PORTRAIT_TEXT);
  });

  it("PROMPT-3: never sends portrait to editor persona even when preference is on", async () => {
    const { result } = renderHook(() => useAIChatContext("editor"));

    const ctx = await result.current.buildContext({
      text: "Привет",
      attached: null,
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
    });

    expect(ctx.userPortrait).toBeNull();
  });
});
