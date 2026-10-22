import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIDialogueService } from '../AIDialogueService';
import { toApiContent, API_MSG_CAP } from '../../utils/aiChatTransport';

// DE-4 (дейлик 2026-10-22, Н-4): писатели диалога и транспорт резали по UTF-16 —
// эмодзи на границе оставлял одиночный суррогат. Мутация: вернуть `.slice`.

vi.mock('../AIService', () => ({ AIService: { chat: vi.fn(), embed: vi.fn(), extractChatMemory: vi.fn() } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// 100 000-й code unit — первая половина эмодзи.
const LONG = `${'я'.repeat(99_999)}😀 хвост`;

beforeEach(async () => {
  await (await getLocalDb()).clear('aiDialogues');
});

async function newDialogue() {
  return AIDialogueService.create({
    title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    messages: [{ role: 'user', content: 'Вопрос' }, { role: 'assistant', content: 'Ответ' }],
  });
}

describe('DE-4: обрезка без одиночных суррогатов', () => {
  it('appendMessage', async () => {
    const d = await newDialogue();
    await AIDialogueService.appendMessage(d.id, LONG, LONG);
    const saved = (await (await getLocalDb()).get('aiDialogues', d.id))!;
    for (const m of saved.messages.slice(2)) {
      expect(m.content.endsWith('[...truncated]')).toBe(true);
      expect(LONE_SURROGATE.test(m.content)).toBe(false);
    }
  });

  it('replaceLastTurn', async () => {
    const d = await newDialogue();
    await AIDialogueService.replaceLastTurn(d.id, d.messages[0]!.id!, LONG, LONG);
    const saved = (await (await getLocalDb()).get('aiDialogues', d.id))!;
    const long = saved.messages.filter(m => m.content.endsWith('[...truncated]'));
    expect(long.length).toBeGreaterThan(0);
    for (const m of long) expect(LONE_SURROGATE.test(m.content)).toBe(false);
  });

  it('toApiContent', () => {
    const api = toApiContent(`${'a'.repeat(API_MSG_CAP - 1)}😀 хвост`);
    expect(api.length).toBeLessThanOrEqual(API_MSG_CAP);
    expect(LONE_SURROGATE.test(api)).toBe(false);
  });
});
