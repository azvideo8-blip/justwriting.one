import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import "fake-indexeddb/auto";
import { useAIChatContext } from "../../services/aiChatContext";
import { AIProfileService } from "../../services/AIProfileService";
import { AIMemoryAssembler } from "../../services/AIMemoryAssembler";
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
// (ctx.userPortrait) AND AIMemoryAssembler's own copy — gating only the first
// would leave it riding into the prompt through the memory budget's 600-char
// floor for the 'portrait' category (AIMemoryAssembler.ts:88-92).
describe("portrait-in-dialogue preference wiring", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    usePortraitDialoguePreferenceStore.setState({ values: {} });
    vi.spyOn(AIProfileService, "getPortrait").mockResolvedValue(PORTRAIT_TEXT);
    vi.spyOn(AIMemoryAssembler, "assembleMemoryContext").mockResolvedValue(null);
  });

  it("sends the portrait when the preference is on (the default)", async () => {
    const { result } = renderHook(() => useAIChatContext("editor"));

    const ctx = await result.current.buildContext({
      text: "Привет",
      attached: null,
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
    });

    expect(ctx.userPortrait).toBe(PORTRAIT_TEXT);
    expect(AIMemoryAssembler.assembleMemoryContext).toHaveBeenCalledWith(
      expect.objectContaining({ userPortrait: PORTRAIT_TEXT })
    );
  });

  it("keeps the portrait out of the reply and the memory assembler when the preference is off", async () => {
    setSendPortraitInDialogue(TEST_UID, false);

    const { result } = renderHook(() => useAIChatContext("editor"));

    const ctx = await result.current.buildContext({
      text: "Привет",
      attached: null,
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
    });

    expect(ctx.userPortrait).toBeFalsy();
    expect(AIMemoryAssembler.assembleMemoryContext).toHaveBeenCalledWith(
      expect.objectContaining({ userPortrait: null })
    );
  });
});
