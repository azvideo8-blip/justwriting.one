import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIService } from '../../services/AIService';
import { AIProfileService } from '../../services/AIProfileService';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { LanguageProvider } from '../../../../shared/i18n';

const PARTIAL = vi.hoisted(() => 'Синтетический ответ, который успел прийти почти целиком. '.repeat(5) + 'и с тех пор не пере');

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

vi.mock('../../utils/aiChatTransport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/aiChatTransport')>();
  return {
    ...actual,
    // Сеть оборвалась после того, как показано больше 200 знаков.
    streamChat: vi.fn().mockImplementation(async (params: { onChunk: (chunk: string, reasoning: string | null) => void }) => {
      params.onChunk(PARTIAL, null);
      throw new TypeError('Load failed');
    }),
  };
});

// Случай #27 (19.11), ход 7: ответ оборван посреди слова без пометки. Сервер
// закончил ход штатно — хвост потерялся по дороге к телефону. Путь AUDIT-M2
// оставляет показанный кусок (не платим второй раз), но молча: человек не
// знает, что ответ не дописан. Теперь — та же пометка, что у «Стоп».
describe('обрыв стрима после показанного куска', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    setIndexingConsent('guest', 'granted');
    vi.spyOn(AIProfileService, 'getPortrait').mockResolvedValue(null);
    vi.spyOn(AIService, 'chat').mockResolvedValue({ ok: false, error: 'DAILY_LIMIT' });
    const db = await getLocalDb();
    await db.clear('aiDialogues');
  });

  it('кусок сохранён с пометкой «ответ не дописан», а не как целый ответ', async () => {
    const { result } = renderHook(() => useAIChat(null, 'coach'), { wrapper: LanguageProvider });
    let dialogueId: string | null = null;
    await act(async () => {
      dialogueId = await result.current.sendMessage('Привет');
    });
    const db = await getLocalDb();
    const saved = await db.get('aiDialogues', dialogueId!);
    const answer = saved!.messages[1]!.content;
    expect(answer).toContain('с тех пор не пере');
    expect(answer).toContain('ответ не дописан');
  });
});
