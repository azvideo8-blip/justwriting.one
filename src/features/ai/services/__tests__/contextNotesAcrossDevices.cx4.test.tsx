// CX-4 (0.11.13): строка «Модель видела N заметок» под ответом, написанным на
// другом устройстве, была пустой — в contextDocIds местные id устройства-автора.
// Теперь эти id идут в ту же таблицу citeRefs (id → uuid), что и ссылки ответа.
// Два «устройства» — одна база по очереди. Фикстуры синтетические.
// Мутации: citeRefsOf без contextDocIds → красные (a) и (c); ContextNotesRow
// через index.get(id) без таблицы → красный (b).
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_cx4' }), getCurrentUserId: () => 'u_cx4' }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string, n: number) => `${k}:${n}`, language: 'ru' }),
}));
vi.mock('../AIService', () => ({ AIService: { chat: vi.fn(), embed: vi.fn(), extractChatMemory: vi.fn() } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));

const { getLocalDb, resetDbInstance } = await import('../../../../core/storage/localDb');
const { AIDialogueService } = await import('../AIDialogueService');
const { ContextNotesRow } = await import('../../components/chat/AIChatMessages');

const U = 'uuid-cx4-shared';
const note = (id: string, extra: Record<string, unknown> = {}) => ({
  id, guestId: 'u_cx4', title: 'Утренняя прогулка', currentVersion: 1, totalWords: 2, totalDuration: 60,
  sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1_700_000_000_000, tags: [], ...extra,
}) as never;
const saved = async (id: string) => (await (await getLocalDb()).get('aiDialogues', id))!;
const dialogue = (messages: never[] = []) => AIDialogueService.create({
  title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
  messages: [{ role: 'user', content: 'Привет' }, { role: 'assistant', content: 'Привет!' }, ...messages],
});

beforeEach(async () => {
  resetDbInstance();
  const db = await getLocalDb();
  await db.clear('documents');
  await db.clear('aiDialogues');
});

describe('CX-4: заметки хода в таблице ссылок', () => {
  it('(a) заметка хода без ссылки в тексте ответа — в таблице', async () => {
    await (await getLocalDb()).put('documents', note('local_cx4_A', { uuid: U }));
    const d = await dialogue();
    await AIDialogueService.appendMessage(d.id, 'Вопрос', 'Ответ без ссылок.', undefined, null, null, ['local_cx4_A']);
    expect((await saved(d.id)).messages.at(-1)?.citeRefs).toEqual({ local_cx4_A: U });
  });

  it('(b) на устройстве B строка находит свою копию заметки и открывает её по id ответа', async () => {
    await (await getLocalDb()).put('documents', note('local_cx4_B', { uuid: U }));
    const onOpen = vi.fn();
    render(<ContextNotesRow ids={['local_cx4_A']} refs={{ local_cx4_A: U }} onOpenNote={onOpen} />);
    await waitFor(() => expect(screen.getByTestId('ai-context-notes')).toBeTruthy());
    expect(screen.getByText('ai_context_notes_row:1')).toBeTruthy();
  });

  it('(b2) скрытая на B заметка по таблице в строку не попадает', async () => {
    await (await getLocalDb()).put('documents', note('local_cx4_B', { uuid: U, excludedFromAI: true }));
    render(<ContextNotesRow ids={['local_cx4_A']} refs={{ local_cx4_A: U }} onOpenNote={vi.fn()} />);
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByTestId('ai-context-notes')).toBeNull();
  });

  it('(c) старый ответ: дозапись берёт и заметки хода', async () => {
    await (await getLocalDb()).put('documents', note('local_cx4_A', { uuid: U }));
    const d = await dialogue([{ role: 'assistant', content: 'Старый ответ.', contextDocIds: ['local_cx4_A'] } as never]);
    await AIDialogueService.backfillCiteRefs(d.id);
    expect((await saved(d.id)).messages.at(-1)?.citeRefs).toEqual({ local_cx4_A: U });
  });
});
