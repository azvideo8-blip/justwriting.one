// «Тот же ход → тот же промпт»: системный промпт каждого типа хода записан целиком.
//
// Эталоны `__golden__/prompt-turn.*.txt` записаны ЭТИМ ЖЕ тестом на базе ветки
// (ta-persona @ 3736ddc5) до правок «диеты». Правка сборки или текста правила
// меняет эталон, и его diff в коммите показывает, что именно получит модель в
// каждом типе хода. В CI снимки не пишутся: забытый эталон — красный тест.
//
// Только синтетика: заметки, портрет и память выдуманы.
import { describe, expect, it } from 'vitest';
import { assembleChatPromptParams, buildChatSystemPrompt, type ChatPromptInput } from '../buildChatPrompt.js';
import { ARCHIVE_TURN_MARK } from '../archiveAnswerRule.js';
import { HYPOTHESIS_TURN_MARK } from '../hypothesisRule.js';

const TODAY = '[Сегодня: среда, 18 ноября 2026 г.]';
const NOTE_HEAD = '[#local_n1olg · 20261118]\n[Прикреплена заметка: "Опять не сказал"]';
const NOTE = `${TODAY}\n\n${NOTE_HEAD}\nСегодня на планёрке снова промолчал, когда Олег забрал мою идею с отчётами. Вслух сказал «да, хорошая мысль».`;
const SEARCH = `${TODAY}\n\n[Результаты поиска по архиву заметок]\n[#local_a1 · 3 ноября 2026 г.]\nПроплыл двадцать дорожек.\n\n[#local_a2 · 9 ноября 2026 г.]\nПоругался с братом из-за дачи.`;
const PORTRAIT = '## Стиль общения\nЛюбит разбор с разных сторон, без поучений.';
const MEMORY = '[Память о пользователе]\n- Факт: работает аналитиком.\n- Обязательство: звонить отцу по воскресеньям.';
const scope = (mode: 'note' | 'wide') => ({ mode, title: 'Опять не сказал', date: '18 ноября 2026 г.' });
const u = (content: string) => ({ role: 'user', content });
const a = (content: string) => ({ role: 'assistant', content });
const attached = (q: string) => `${NOTE_HEAD}\n\n— — —\nВопрос: ${q}`;
const QUESTION_RUN = [u('Привет'), a('Что сегодня было?'), u('Устал.'), a('От чего больше всего?'), u('От планёрки.'), a('Что там случилось?'), u('Промолчал опять.')];

type Case = Omit<ChatPromptInput, 'personaId'> & { personaId?: string };
const base: Case = { responseLength: 'standard', userPortrait: PORTRAIT, memoryContext: MEMORY };

const TURNS: Record<string, Case> = {
  // Строгий ход по приложенной заметке.
  'strict-first': { ...base, documentContent: NOTE, noteScope: scope('note'), messages: [u(attached('Разбери эту запись'))] },
  'strict-later': { ...base, documentContent: NOTE, noteScope: scope('note'), messages: [u(attached('Разбери эту запись')), a('Похоже, слова приходят позже. Что было в тот момент?'), u('А почему я так делаю?')] },
  'strict-cbt': { ...base, personaId: 'cbt', documentContent: NOTE, noteScope: scope('note'), messages: [u(attached('Разбери эту запись'))] },
  'strict-panel-vy': { ...base, personaId: 'group_psychology', documentContent: NOTE, noteScope: scope('note'), messages: [u(attached('Скажите, что вы видите в этой записи?'))] },
  'strict-parts-detailed': { ...base, personaId: 'parts', responseLength: 'detailed', documentContent: NOTE, noteScope: scope('note'), messages: [u(attached('Разбери подробно'))] },
  'strict-long-note': { ...base, responseLength: 'detailed', documentContent: `${NOTE}\n${'Длинный абзац записи. '.repeat(800)}`, noteScope: scope('note'), messages: [u(attached('Разбери подробно'))] },
  // Широкий ход: заметка приложена, но вопрос шире неё.
  'wide-note': { ...base, documentContent: `${NOTE}\n\n${SEARCH.slice(TODAY.length + 2)}`, noteScope: scope('wide'), messages: [u(attached('А что я ещё писал про Олега?'))] },
  // Без приложенной заметки.
  'search-first': { ...base, documentContent: SEARCH, messages: [u('Что у меня было с братом?')] },
  'search-later': { ...base, documentContent: SEARCH, messages: [u('Привет'), a('Привет. С чего начнём?'), u('Что у меня было с братом?')] },
  'archive': { ...base, documentContent: `${TODAY}\n\n${ARCHIVE_TURN_MARK}\n[#local_a1 · 3 ноября 2026 г.]\nПроплыл двадцать дорожек.`, messages: [u('Когда я впервые писал про бассейн?')] },
  'archive-short': { ...base, responseLength: 'short', documentContent: `${TODAY}\n\n${ARCHIVE_TURN_MARK}\n[#local_a1 · 3 ноября 2026 г.]\nПроплыл двадцать дорожек.`, messages: [u('Когда я впервые писал про бассейн?')] },
  'hypothesis': { ...base, documentContent: `${TODAY}\n\n${HYPOTHESIS_TURN_MARK}\n[#local_a1 · 3 ноября 2026 г.]\nПроплыл двадцать дорожек.\n\n[#local_a2 · 9 ноября 2026 г.]\nПоругался с братом из-за дачи.`, messages: [u('Почему я всё время откладываю то, чего сам хочу?')] },
  'smalltalk-first': { ...base, documentContent: TODAY, messages: [u('Привет, как дела?')] },
  'smalltalk-bare': { responseLength: 'standard', messages: [u('Привет')] },
  'crisis': { ...base, crisis: true, documentContent: SEARCH, messages: [u('Не хочу больше просыпаться.')] },
  'summary-due': { ...base, documentContent: TODAY, messages: QUESTION_RUN },
  'english': { ...base, documentContent: SEARCH, messages: [u('What did I write about my brother?')] },
  'reasoning': { ...base, reasoning: true, documentContent: SEARCH, messages: [u('Что у меня было с братом?')] },
  'short': { ...base, responseLength: 'short', documentContent: TODAY, messages: [u('Устал сегодня.')] },
  // Транзактный аналитик: шаги по истории.
  'ta-parent': { ...base, personaId: 'ta', documentContent: TODAY, messages: [u('Я должна каждый вечер звонить маме, хотя сил нет.')] },
  'ta-adult': { ...base, personaId: 'ta', documentContent: TODAY, messages: [u('Я должна каждый вечер звонить маме, хотя сил нет.'), a('Похоже, тут говорит Родитель. А чего хочет Ребёнок?'), u('Хочется лечь и выключить телефон.')] },
  'ta-crisis': { ...base, personaId: 'ta', crisis: true, documentContent: TODAY, messages: [u('Я должна держаться, но не хочу больше просыпаться.')] },
  // Редактор и своя персона.
  'editor-post': { ...base, personaId: 'editor', authorGender: 'm', documentContent: NOTE, noteScope: scope('note'), messages: [u(attached('Сделай пост'))] },
  'editor-eval': { ...base, personaId: 'editor', documentContent: NOTE, noteScope: scope('note'), messages: [u(attached('Как тебе черновик?'))] },
  'editor-list': { ...base, personaId: 'editor', documentContent: SEARCH, messages: [u('Выпиши главное по датам')] },
  'custom': { ...base, personaId: 'custom', customSystemPrompt: 'Говори как добрый сосед.', documentContent: SEARCH, messages: [u('Что у меня было с братом?')] },
  'custom-strict': { ...base, personaId: 'custom', customSystemPrompt: 'Говори как добрый сосед.', documentContent: NOTE, noteScope: scope('note'), messages: [u(attached('Разбери эту запись'))] },
};

const promptOf = (c: Case): string =>
  buildChatSystemPrompt({ ...assembleChatPromptParams({ personaId: 'coach', ...c }), rnd: () => 0 });

describe('тот же ход → тот же промпт', () => {
  for (const [name, c] of Object.entries(TURNS)) {
    it(name, async () => {
      const prompt = promptOf(c);
      expect(promptOf(c)).toBe(prompt);
      await expect(prompt).toMatchFileSnapshot(`./__golden__/prompt-turn.${name}.txt`);
    });
  }
});
