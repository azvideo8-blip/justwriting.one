// DT-3 (дейлик 04.11, подозрение ревьюера): слияние копий переносит
// `contextDocIds` из старой копии, когда у свежей поля нет (`dialogueMerge.ts:141`),
// а писатель опускал поле и когда список стал ПУСТЫМ после скрытия заметки от ИИ
// (`AIDialogueService.ts:190`, `:237` до правки: `...(contextDocIds?.length ? {…} : {})`).
// «Свежая копия без поля + старая копия с id скрытой теперь заметки + тот же текст»
// — id возвращается в строку, которую синк уносит в облако.
// Обе стороны настоящие: свежая копия написана сервисом (ход с скрытыми материалами),
// старая — её снимок с id заметки до скрытия; дальше — настоящий `mergeDialogues`.
// Фикстуры синтетические (MARKER_D35_*), живой записи нет.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../../../core/storage/localDb';
import type { AIDialogue, DialogueMessage } from '../../../../core/storage/localDb';
import { AIDialogueService } from '../AIDialogueService';
import { mergeDialogues } from '../../../../core/storage/dialogueMerge';

vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
}));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_d35', email: 'someone@example.com' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const QUESTION_TEXT = 'О чём я писал утром?';
const ANSWER_TEXT = 'Утром была пробежка.';

async function storedDialogue(id: string): Promise<AIDialogue> {
  const db = await getLocalDb();
  return (await db.transaction('aiDialogues').store.get(id)) as AIDialogue;
}

const answerOf = (d: AIDialogue): DialogueMessage => d.messages.find(m => m.role === 'assistant')!;

/** Настоящий писатель: ход, где все материалы скрыты от ИИ => список пустой. */
async function writeHiddenContextTurn(): Promise<AIDialogue> {
  const created = await AIDialogueService.create({
    title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    messages: [{ role: 'user', content: QUESTION_TEXT }],
  });
  await AIDialogueService.appendMessage(created.id, QUESTION_TEXT, ANSWER_TEXT, undefined, undefined, undefined, [], false);
  return storedDialogue(created.id);
}

describe('DT-3: пустой список материалов хода отличается от «клиент ничего не писал»', () => {
  beforeEach(async () => {
    resetDbInstance();
    const db = await getLocalDb();
    await db.transaction('aiDialogues', 'readwrite').store.clear();
  });

  it('писатель, у которого все материалы скрыты, ставит явный пустой список', async () => {
    expect(answerOf(await writeHiddenContextTurn()).contextDocIds).toEqual([]);
  });

  it('скрытый от ИИ id не возвращается в свежую копию через слияние', async () => {
    const fresh = await writeHiddenContextTurn();
    // Облачная копия того же хода, записанная до скрытия: тот же id реплики и тот
    // же текст, но материалы хода ещё перечислены (среди них — ставшая скрытой).
    const staleAnswer = (m: DialogueMessage): DialogueMessage =>
      m.role === 'assistant' ? { ...m, contextDocIds: ['MARKER_D35_hidden'] } : m;
    const cloudCopy: AIDialogue = {
      ...fresh,
      updatedAt: fresh.updatedAt - 1000,
      messages: fresh.messages.map(staleAnswer),
    };
    const merged = mergeDialogues(fresh, cloudCopy, 1_700_000_000_000);
    expect(merged.messages.find(m => m.role === 'assistant')?.contextDocIds ?? []).not.toContain('MARKER_D35_hidden');
  });

  // Зелёный контроль (совместимость К21-3): копия со СТАРОГО бандла, где поля нет
  // вовсе, по-прежнему не теряет сохранённый список соседней копии — правка не
  // отменяет перенос, она делает «пусто» различимым.
  it('копия старого клиента без поля не теряет список соседней копии', () => {
    const base = (extra: Partial<DialogueMessage>): DialogueMessage => ({
      role: 'assistant', id: 'a1', content: ANSWER_TEXT, createdAt: 11, turnId: 'u1', ...extra,
    });
    const question: DialogueMessage = { role: 'user', id: 'u1', content: QUESTION_TEXT, createdAt: 10 };
    const dialogue = (messages: DialogueMessage[]): AIDialogue => ({
      id: 'd', title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      createdAt: 1000, updatedAt: 2000, messages,
    });
    const merged = mergeDialogues(
      dialogue([question, base({ updatedAt: 200 })]),
      dialogue([question, base({ updatedAt: 100, contextDocIds: ['MARKER_D35_seen'] })]),
      1_700_000_000_000,
    );
    expect(merged.messages[1]?.contextDocIds).toEqual(['MARKER_D35_seen']);
  });
});
