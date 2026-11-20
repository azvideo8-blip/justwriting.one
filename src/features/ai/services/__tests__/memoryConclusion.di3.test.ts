// DI-3 (выводы из разговоров): вид памяти `conclusion` — хранение, дубль, удаление вместе с диалогом,
// не попадает в общий блок памяти, скрытая опора, сбой чтения не «пусто». Настоящий сервис поверх
// fake-indexeddb; подменены край сети (embed не нужен) и getLocalDb по флагу (сбой чтения).
// Мутации: см. комментарии у кейсов.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const failRead = vi.hoisted(() => ({ on: false }));
vi.mock('@/core/storage/localDb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/storage/localDb')>();
  return {
    ...actual,
    getLocalDb: async (uid?: string) => {
      if (failRead.on) throw new Error('MARKER_IDB_DOWN');
      return actual.getLocalDb(uid);
    },
  };
});
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { AIChatMemoryService } from '@/features/ai/services/AIChatMemoryService';
import { AIDialogueService } from '@/features/ai/services/AIDialogueService';
import { LocalStoreSyncService } from '@/core/services/LocalStoreSyncService';
import { getLocalDb } from '@/core/storage/localDb';

const base = {
  text: 'Своё и приятное у тебя идёт только после того, как всё остальное сделано.',
  context: 'Опять сначала почта, потом посуда, потом ночь.',
  dialogueId: 'dlg_a',
  messageId: 'msg_1',
  sourceDocumentIds: [] as string[],
  confirmedBy: 'reply' as const,
};

beforeEach(async () => {
  failRead.on = false;
  vi.restoreAllMocks();
  const db = await getLocalDb();
  await db.clear('aiChatMemory');
  await db.clear('aiDialogues');
  await db.clear('documents');
});

describe('DI-3: AIChatMemoryService — вывод', () => {
  it('addConclusion пишет запись без vector, с sourceDocumentIds: [] и ставит её в выгрузку', async () => {
    const sync = vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});
    expect(await AIChatMemoryService.addConclusion(base)).toBe('saved');
    const all = await (await getLocalDb()).getAll('aiChatMemory');
    expect(all).toHaveLength(1);
    const rec = all[0]!;
    expect(rec).toMatchObject({ kind: 'conclusion', text: base.text, context: base.context, sourceDialogueId: 'dlg_a', sourceMessageId: 'msg_1', sourceDocumentIds: [], confirmedBy: 'reply' });
    expect(rec.vector).toBeUndefined();
    expect(typeof rec.confirmedAt).toBe('number');
    // Мутация: убрать scheduleStoreSync — красный.
    expect(sync).toHaveBeenCalledWith('aiChatMemory', rec.id);
  });

  it('контекст обрезается до 300 знаков', async () => {
    await AIChatMemoryService.addConclusion({ ...base, context: 'к'.repeat(500) });
    expect((await (await getLocalDb()).getAll('aiChatMemory'))[0]!.context).toHaveLength(300);
  });

  it('тот же текст в другом регистре и с «ё» — duplicate, запись одна, отметка обновлена', async () => {
    await AIChatMemoryService.addConclusion({ ...base, text: 'Ты ждёшь разрешения' + ' на своё, и потому всё откладываешь.' });
    const first = (await (await getLocalDb()).getAll('aiChatMemory'))[0]!;
    await new Promise(r => setTimeout(r, 5));
    // Мутация: сравнивать без нормализации — красный.
    const res = await AIChatMemoryService.addConclusion({ ...base, text: 'ТЫ ЖДЕШЬ  разрешения на своё, и потому всё откладываешь.' });
    expect(res).toBe('duplicate');
    const all = await (await getLocalDb()).getAll('aiChatMemory');
    expect(all).toHaveLength(1);
    expect(all[0]!.confirmedAt).toBeGreaterThan(first.confirmedAt!);
  });

  it('удаление диалога удаляет его вывод и не трогает вывод другого диалога', async () => {
    const db = await getLocalDb();
    for (const id of ['dlg_a', 'dlg_b']) {
      await db.put('aiDialogues', { id, title: 't', personaId: 'editor', personaName: 'Р', personaEmoji: '✍️', createdAt: 1, updatedAt: 1, messages: [] });
    }
    await AIChatMemoryService.addConclusion({ ...base, dialogueId: 'dlg_a', text: 'Вывод из первого разговора про отдых и дела.' });
    await AIChatMemoryService.addConclusion({ ...base, dialogueId: 'dlg_b', text: 'Вывод из второго разговора про страх отказа.' });
    // Мутация: в addConclusion писать sourceDialogueId: 'manual' — красный (deleteByDialogue 'manual' не трогает).
    await AIDialogueService.delete('dlg_a');
    const left = await AIChatMemoryService.getConclusions();
    expect(left.map(m => m.sourceDialogueId)).toEqual(['dlg_b']);
  });

  it('getRelevant не возвращает вывод, даже с проставленным руками vector', async () => {
    const db = await getLocalDb();
    await AIChatMemoryService.addConclusion(base);
    const rec = (await db.getAll('aiChatMemory'))[0]!;
    await db.put('aiChatMemory', { ...rec, vector: [1, 0, 0] });
    await db.put('aiChatMemory', { id: 'fact1', kind: 'fact', text: 'Обычный факт.', sourceDialogueId: 'd', createdAt: 1, updatedAt: 1, sourceDocumentIds: [], vector: [1, 0, 0] } as never);
    // Мутация: убрать фильтр kind !== 'conclusion' в getRelevant — красный.
    const got = await AIChatMemoryService.getRelevant([1, 0, 0], 5);
    expect(got.map(m => m.id)).toEqual(['fact1']);
  });

  it('getUsableConclusions: опора скрыта — вывода нет в списке; getConclusions его показывает', async () => {
    const db = await getLocalDb();
    await db.put('documents', { id: 'doc_visible', guestId: 'u1', title: 'a', currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [] } as never);
    await db.put('documents', { id: 'doc_hidden', guestId: 'u1', title: 'b', excludedFromAI: true, currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [] } as never);
    await AIChatMemoryService.addConclusion({ ...base, text: 'Вывод с видимой опорой про усталость и дела.', sourceDocumentIds: ['doc_visible'] });
    await AIChatMemoryService.addConclusion({ ...base, text: 'Вывод со скрытой опорой про страх отказа.', sourceDocumentIds: ['doc_hidden'] });
    const docs = await db.getAll('documents');
    const usable = await AIChatMemoryService.getUsableConclusions(docs);
    expect(usable.map(m => m.sourceDocumentIds)).toEqual([['doc_visible']]);
    expect(await AIChatMemoryService.getConclusions()).toHaveLength(2);
  });

  it('вывод без ссылок на заметки (sourceDocumentIds: []) ИИ отдаётся; с undefined — нет', async () => {
    await AIChatMemoryService.addConclusion(base);
    expect(await AIChatMemoryService.getUsableConclusions([])).toHaveLength(1);
    // Мутация: писать sourceDocumentIds как undefined — вывод перестаёт отдаваться совсем (этот кейс красный).
  });

  it('getConclusions при упавшем getLocalDb отклоняет промис (сбой ≠ «пусто»)', async () => {
    failRead.on = true;
    // Мутация: try/catch → [] — красный.
    await expect(AIChatMemoryService.getConclusions()).rejects.toThrow('MARKER_IDB_DOWN');
  });

  it('addConclusion при упавшем хранилище — failed, не бросок', async () => {
    failRead.on = true;
    expect(await AIChatMemoryService.addConclusion(base)).toBe('failed');
  });
});
