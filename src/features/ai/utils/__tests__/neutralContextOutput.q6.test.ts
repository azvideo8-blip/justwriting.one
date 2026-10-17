// DLG-Q6 (Fable T-10): модель видела мужской род в шапках контекста каждый ход и
// тянула его в ответ женщине — в main 10 случаев из 210.
//
// Прежняя версия теста (R7Q-036 назвала её холостой) только читала три исходника
// и искала в них строки: ни один прод-код не выполнялся, а имя обещало поведение.
// Здесь те же утверждения снимаются с ВЫВОДА настоящих собирщиков контекста:
// `buildProactiveBlock` и `formatContradictions(detectContradictions(...))`.
// Старая родовая шапка, возвращённая в код, краснит тест сама — без grep'а.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import type { AITimelineEntry } from '../../../../core/storage/localDb';
import { buildProactiveBlock } from '../../services/chatContext/proactive';
import { detectContradictions, formatContradictions } from '../../utils/contradictionDetect';
import { AIMonthlyDigestService } from '../../services/AIMonthlyDigestService';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const BANNED = [
  '[Что ты писал недавно]',
  '[Твои открытые планы',
  'Твое отношение к теме',
  // Прежняя формулировка подсказки дверей: «пригласи заметить X под Y».
  /пригласи заметить[^\n]*? под \$\{/,
];

function expectNeutral(text: string, where: string): void {
  for (const banned of BANNED) {
    if (typeof banned === 'string') {
      expect(text, `${where}: вернулась родовая строка «${banned}»`).not.toContain(banned);
    } else {
      expect(text, `${where}: вернулся шаблон ${banned}`).not.toMatch(banned);
    }
  }
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function clearStores(): Promise<void> {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiCommitments', 'aiTimeline'] as const) {
    for (const rec of await db.getAll(store)) {
      await db.delete(store, (rec as { id: string }).id);
    }
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearStores();
  vi.spyOn(AIMonthlyDigestService, 'getRecent').mockResolvedValue([] as never);
});

describe('Q-6: собранный контекст не говорит о человеке в мужском роде', () => {
  it('проактивный блок собран по нейтральным шапкам', async () => {
    const db = await getLocalDb();
    const now = Date.now();
    await db.put('documents', {
      id: 'local_q6_note', guestId: 'u1', title: 'Про релиз', currentVersion: 1, totalWords: 30,
      totalDuration: 0, sessionsCount: 1, firstSessionAt: now, lastSessionAt: now, tags: [],
    } as never);
    await db.put('aiSummaries', {
      id: 'local_q6_note', documentId: 'local_q6_note', summary: 'Собрали релиз, обсудили сроки и устали.',
      tone: 'спокойный', processedAt: now, eventDate: dayKey(new Date(now)),
    } as never);
    await db.put('aiCommitments', {
      id: 'c1', documentId: 'local_q6_note', text: 'Планирует дописать тесты', date: dayKey(new Date(now)),
      status: 'open', createdAt: now,
    } as never);

    const block = await buildProactiveBlock({ personaId: 'coach', turnEmb: undefined });

    expect(block, 'проактивный блок пуст — стенд ничего не собирает').toContain('[Недавние записи]');
    expect(block).toContain('[Открытые планы / обязательства]');
    expectNeutral(block, 'buildProactiveBlock');
  });

  it('строка противоречия нейтральна: «Отношение к теме», а не «Твое отношение к теме»', () => {
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const recent = new Date();
    const timeline = [
      {
        documentId: 'd1', date: dayKey(old), month: dayKey(old).slice(0, 7), facts: ['факт'],
        themes: ['Работа'], valence: 0.8,
      },
      {
        documentId: 'd2', date: dayKey(recent), month: dayKey(recent).slice(0, 7), facts: ['факт'],
        themes: ['Работа'], valence: -0.8,
      },
    ] as AITimelineEntry[];

    const text = formatContradictions(detectContradictions(timeline));
    expect(text, 'противоречие не распознано — проверке нечего сказать').toContain('Отношение к теме');
    expectNeutral(text, 'formatContradictions');
  });

  it('пустой ввод даёт пустой текст, а не родовую строку по умолчанию', () => {
    expect(formatContradictions([])).toBe('');
    expectNeutral(formatContradictions([]), 'formatContradictions на пустом входе');
  });
});
