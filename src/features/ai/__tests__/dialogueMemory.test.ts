import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getLocalDb } from '../../../core/storage/localDb';
import { AIDialogueService } from '../services/AIDialogueService';

vi.mock('../services/AIService', () => ({
  AIService: {
    embed: vi.fn().mockResolvedValue({
      ok: true,
      vectors: [new Array(1536).fill(0.1)],
    }),
  },
}));

describe('Dialogue Memory Purge (RING-0)', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    await db.clear('aiDialogues');
    await db.clear('aiDialogueEvents');
    await db.clear('aiChatMemory');
    await db.clear('aiProfileFacets');
  });

  it('removes derived memories and dialogue events but preserves manual ones on delete', async () => {
    const db = await getLocalDb();

    // Create a dialogue
    const dialogue = await AIDialogueService.create({
      title: 'Тестовый диалог',
      personaId: 'cbt',
      personaName: 'Терапевт',
      personaEmoji: '🧠',
      messages: [],
    });

    // Add 2 dialogue-derived memories
    await db.put('aiChatMemory', {
      id: 'mem_derived_1',
      kind: 'fact',
      text: 'Derived Fact 1',
      sourceDialogueId: dialogue.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await db.put('aiChatMemory', {
      id: 'mem_derived_2',
      kind: 'insight',
      text: 'Derived Insight 2',
      sourceDialogueId: dialogue.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Add 1 manual memory
    await db.put('aiChatMemory', {
      id: 'mem_manual',
      kind: 'preference',
      text: 'Manual preference',
      sourceDialogueId: 'manual',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Add dialogue event (e.g. mock archive step output)
    await db.put('aiDialogueEvents', {
      dialogueId: dialogue.id,
      date: '2026-07-21',
      month: '2026-07',
      personaId: 'cbt',
      personaName: 'Терапевт',
      summary: 'Summary text',
      themes: [],
    });

    // Add dialogue to a profile facet dialogueIds
    await db.put('aiProfileFacets', {
      id: 'facet_test',
      label: 'Test Facet',
      summary: 'Summary',
      centroid: [],
      noteIds: [],
      dialogueIds: [dialogue.id],
      noteCount: 0,
      firstAt: 0,
      lastAt: 0,
      updatedAt: Date.now(),
      buildId: 'test',
    });

    // Verify they exist before delete
    expect(await db.get('aiDialogues', dialogue.id)).toBeDefined();
    expect(await db.get('aiDialogueEvents', dialogue.id)).toBeDefined();
    expect(await db.get('aiChatMemory', 'mem_derived_1')).toBeDefined();
    expect(await db.get('aiChatMemory', 'mem_derived_2')).toBeDefined();
    expect(await db.get('aiChatMemory', 'mem_manual')).toBeDefined();
    
    const facetBefore = await db.get('aiProfileFacets', 'facet_test');
    expect(facetBefore?.dialogueIds).toContain(dialogue.id);

    // Act: Delete the dialogue
    await AIDialogueService.delete(dialogue.id);

    // Assert: Dialogue is gone
    expect(await db.get('aiDialogues', dialogue.id)).toBeUndefined();
    // Assert: Dialogue event is gone
    expect(await db.get('aiDialogueEvents', dialogue.id)).toBeUndefined();
    // Assert: Derived memories are gone
    expect(await db.get('aiChatMemory', 'mem_derived_1')).toBeUndefined();
    expect(await db.get('aiChatMemory', 'mem_derived_2')).toBeUndefined();
    // Assert: Manual memory survives
    expect(await db.get('aiChatMemory', 'mem_manual')).toBeDefined();
    
    // Assert: Dialogue ID dropped from facets
    const facetAfter = await db.get('aiProfileFacets', 'facet_test');
    expect(facetAfter?.dialogueIds).not.toContain(dialogue.id);
  });
});
