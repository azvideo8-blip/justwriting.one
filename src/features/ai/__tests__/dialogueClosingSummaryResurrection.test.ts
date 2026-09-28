import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../core/storage/localDb';
import { AIDialogueService } from '../services/AIDialogueService';
import { LocalStoreSyncService } from '../../../core/services/LocalStoreSyncService';
import { AIService } from '../services/AIService';

vi.mock('../services/AIService', () => ({
  AIService: {
    chat: vi.fn(),
    embed: vi.fn().mockResolvedValue({ ok: true, vectors: [] }),
  },
}));

describe('A-3.2 (F-007): dialogue closing summary resurrection protection', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await getLocalDb();
    await db.clear('aiDialogues');
    await db.clear('aiDialogueEvents');
    await db.clear('aiChatMemory');
    (LocalStoreSyncService as unknown as { pending: Map<string, unknown> }).pending.clear();
    localStorage.clear();
  });

  it('Acceptance 1: archive -> delete while AI call pending -> resolve AI call -> no event in IDB and no upsert scheduled', async () => {
    const db = await getLocalDb();

    // Create a dialogue with >= 4 messages
    const dialogue = await AIDialogueService.create({
      title: 'Active dialogue',
      personaId: 'cbt',
      personaName: 'Therapist',
      personaEmoji: '🧠',
      messages: [
        { role: 'user', content: 'Hello 1' },
        { role: 'assistant', content: 'Hi 1' },
        { role: 'user', content: 'Hello 2' },
        { role: 'assistant', content: 'Hi 2' },
      ],
    });

    let resolveChat!: (res: { ok: true; text: string }) => void;
    const chatPromise = new Promise<{ ok: true; text: string }>((resolve) => {
      resolveChat = resolve;
    });
    vi.mocked(AIService.chat).mockImplementation(() => chatPromise);

    const scheduleSyncSpy = vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync');

    // 1. Archive initiates generateClosingSummary in background
    await AIDialogueService.archive(dialogue.id);

    // Wait for generateClosingSummary to call AIService.chat
    await vi.waitFor(() => expect(AIService.chat).toHaveBeenCalled());

    // 2. User deletes dialogue while AI call is in-flight
    await AIDialogueService.delete(dialogue.id);

    scheduleSyncSpy.mockClear();

    // 3. Resolve AI call
    resolveChat({ ok: true, text: 'Generated closing summary' });

    // Allow async tasks to complete
    await new Promise((r) => setTimeout(r, 50));

    // Verify: no dialogue event in IndexedDB
    const event = await db.get('aiDialogueEvents', dialogue.id);
    expect(event, 'dialogue event must not be resurrected in IDB').toBeUndefined();

    // Verify: no upsert scheduled for aiDialogueEvents or aiDialogues
    expect(scheduleSyncSpy).not.toHaveBeenCalledWith('aiDialogueEvents', dialogue.id);
    expect(scheduleSyncSpy).not.toHaveBeenCalledWith('aiDialogues', dialogue.id);
  });

  it('Acceptance 2: scheduleStoreDelete -> scheduleStoreSync for non-existent record -> pending entry remains delete', async () => {
    const store = 'aiDialogues';
    const key = 'non_existent_key_123';

    LocalStoreSyncService.scheduleStoreDelete(store, key);

    // scheduleStoreSync should check IDB and, finding no record, ignore the upsert
    LocalStoreSyncService.scheduleStoreSync(store, key);

    // Allow any async IDB check to settle
    await new Promise((r) => setTimeout(r, 50));

    const pendingMap = (LocalStoreSyncService as unknown as { pending: Map<string, { isDelete: boolean }> }).pending;
    const entry = pendingMap.get(`${store}:${key}`);
    expect(entry).toBeDefined();
    expect(entry?.isDelete).toBe(true);
  });
});
