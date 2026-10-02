import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import type { AIDialogue } from '../../../../core/storage/localDb';
import { AIDialogueService } from '../AIDialogueService';
import { AIChatMemoryService } from '../AIChatMemoryService';
import { LocalStoreSyncService } from '../../../../core/services/LocalStoreSyncService';
import { tombstoneDialogue } from '../../../../core/storage/dialogueMerge';
import { countLocalDataInventory } from '../../../auth/services/localDataInventory';

// M-4: надгробие диалога (S-58) — не запись, в которую можно писать. Эти тесты
// краснеют, если убрать ранний выход в setPersona/updateTitle/
// updateResponseLength/курсоре памяти или если надгробие снова посчитается
// диалогом в статистике и в инвентаре выхода из аккаунта.

const extractChatMemory = vi.fn().mockResolvedValue({ ok: true, memories: [] });
vi.mock('../AIService', () => ({ AIService: { chat: vi.fn(), embed: vi.fn(), extractChatMemory: (...a: unknown[]) => extractChatMemory(...a) } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../utils/aiDegradationReporter', () => ({ reportAIDegradation: vi.fn() }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));

const scheduleSync = LocalStoreSyncService.scheduleStoreSync as ReturnType<typeof vi.fn>;

async function stored(id: string): Promise<AIDialogue | undefined> {
  return (await getLocalDb()).get('aiDialogues', id) as Promise<AIDialogue | undefined>;
}

async function liveDialogue(id = 'd_live'): Promise<AIDialogue> {
  const db = await getLocalDb();
  const d: AIDialogue = {
    id,
    title: 'Т',
    personaId: 'coach',
    personaName: 'Коуч',
    personaEmoji: '🎯',
    createdAt: 1_000,
    updatedAt: 2_000,
    messages: [
      { id: 'm1', role: 'user', content: 'Вопрос первый, длиннее десяти знаков', createdAt: 1_000 },
      { id: 'm2', role: 'assistant', content: 'Ответ первый', createdAt: 1_001 },
      { id: 'm3', role: 'user', content: 'Вопрос второй, тоже длиннее десяти знаков', createdAt: 1_002 },
    ],
  };
  await db.put('aiDialogues', d);
  return d;
}

async function buriedDialogue(id = 'd_dead'): Promise<AIDialogue> {
  const d = await liveDialogue(id);
  const db = await getLocalDb();
  const tomb = tombstoneDialogue(d, 5_000);
  await db.put('aiDialogues', tomb);
  return tomb;
}

beforeEach(async () => {
  vi.clearAllMocks();
  const db = await getLocalDb();
  await db.clear('aiDialogues');
  if (db.objectStoreNames.contains('aiDialogueEvents')) await db.clear('aiDialogueEvents');
  if (db.objectStoreNames.contains('aiChatMemory')) await db.clear('aiChatMemory');
});

describe('M-4: писатели не трогают надгробие', () => {
  it('setPersona: в надгробие не пишет и не ставит запись в выгрузку', async () => {
    const tomb = await buriedDialogue();
    const before = JSON.stringify(await stored(tomb.id));

    const result = await AIDialogueService.setPersona(tomb.id, { personaId: 'x', personaName: 'Иной', personaEmoji: '🎯' });

    expect(result).toBeUndefined();
    expect(JSON.stringify(await stored(tomb.id)), 'надгробие изменилось').toBe(before);
    expect(scheduleSync).not.toHaveBeenCalled();
  });

  it('setPersona: живой диалог по-прежнему пишется (иначе тест ничего не проверяет)', async () => {
    const d = await liveDialogue();
    const result = await AIDialogueService.setPersona(d.id, { personaId: 'x', personaName: 'Иной', personaEmoji: '🎯' });
    expect(result?.personaName).toBe('Иной');
    expect(scheduleSync).toHaveBeenCalledWith('aiDialogues', d.id);
  });

  it('updateTitle и updateResponseLength: та же граница', async () => {
    const tomb = await buriedDialogue('d_dead2');
    const before = JSON.stringify(await stored(tomb.id));
    await AIDialogueService.updateTitle(tomb.id, 'Новое имя');
    await AIDialogueService.updateResponseLength(tomb.id, 'short');
    expect(JSON.stringify(await stored(tomb.id)), 'в надгробие записали заголовок или объём').toBe(before);

    const d = await liveDialogue('d_live2');
    await AIDialogueService.updateTitle(d.id, 'Новое имя');
    expect((await stored(d.id))!.title).toBe('Новое имя');
    await AIDialogueService.updateResponseLength(d.id, 'detailed');
    expect((await stored(d.id))!.responseLength).toBe('detailed');
  });

  it('replaceLastTurn: перегенерация в удалённый диалог не пишется', async () => {
    const tomb = await buriedDialogue('d_dead3');
    const before = JSON.stringify(await stored(tomb.id));
    await AIDialogueService.replaceLastTurn(tomb.id, 'm1', 'Вопрос первый', 'Перегенерированный ответ');
    expect(JSON.stringify(await stored(tomb.id)), 'перегенерация воскресила диалог').toBe(before);
  });

  it("generateClosingSummary: диалог сняли, пока модель думала, — итог и событие не пишутся", async () => {
    const d = await liveDialogue('d_live4');
    const db = await getLocalDb();
    await db.put(
      'aiDialogues',
      { ...d, messages: [...d.messages, { id: 'm4', role: 'assistant', content: 'Ответ второй', createdAt: 1003 }] } as never,
    );
    // Модель отвечает долго, и в этот момент диалог удаляют. Страж S-58 стоит после
    // await-а модели и внутри транзакции: ранний выход в начале функции его не
    // заменяет — без него итог ложился в надгробие и поднимал updatedAt.
    const { AIService } = await import('../AIService');
    (AIService.chat as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const tx = db.transaction('aiDialogues', 'readwrite');
      const row = await tx.store.get('d_live4');
      await tx.store.put(tombstoneDialogue(row!, 5000));
      await tx.done;
      return { ok: true, text: 'Итог разговора' };
    });

    await AIDialogueService.generateClosingSummary('d_live4');

    const after = (await stored('d_live4'))!;
    expect(after.closingSummary, 'итог записан в надгробие').toBeUndefined();
    expect(after.updatedAt, 'надгробие получило новую отметку').toBe(5000);
    const events = db.objectStoreNames.contains('aiDialogueEvents') ? await db.getAll('aiDialogueEvents') : [];
    expect(events.filter(e => e.dialogueId === 'd_live4'), 'событие итога вписано в удалённый диалог').toEqual([]);
  });

  it('курсор извлечения памяти не ставится в удалённый диалог', async () => {
    const tomb = await buriedDialogue('d_dead5');
    const msgs = [
      { role: 'user', content: 'Вопрос первый, длиннее десяти знаков', id: 'm1' },
      { role: 'assistant', content: 'Ответ первый', id: 'm2' },
      { role: 'user', content: 'Вопрос второй, тоже длиннее десяти знаков', id: 'm3' },
    ];
    await AIChatMemoryService.extractFromDialogue(tomb.id, msgs);
    expect((await stored(tomb.id))!.lastExtractedMessageId).toBeUndefined();

    const d = await liveDialogue('d_live5');
    await AIChatMemoryService.extractFromDialogue(d.id, msgs);
    expect((await stored(d.id))!.lastExtractedMessageId).toBe('m3');
  });

  it('инвентарь выхода из аккаунта не считает надгробие диалогом', async () => {
    await buriedDialogue('d_dead6');
    await liveDialogue('d_live6');
        // Инвентарь читает базу того же uid, что и весь тест (getLocalDb() без домена).
    const inv = await countLocalDataInventory();
    expect(inv.dialoguesCount).toBe(1);
  });
});
