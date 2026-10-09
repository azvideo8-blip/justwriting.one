// A-1 (0.9.34): род в примерах правил.
//
// Когда модель не опирается на текст человека, она берёт род из примеров в
// промпте. Тексты правил мерились на корпусе от женщины, и в примеры залез
// женский род («ты собиралась сделать»); на мужском авторе ответы уходили в
// женские формы обращений (прод, 0.9.33). Источник форм — эталоны харнесса
// variants/v5.json и v6.json: оттуда примеры попали в NOTES_GUARD_BASE и
// REFLECTION_GUIDE дословно.
//
// Проверяются не только константы, но и собранные системные промпты всех персон
// во всех режимах: правки строк buildChatPrompt.ts попадают только туда.
//
// Мутация, на которой тест краснеет: вернуть в NOTES_GUARD_BASE
// «(«ты собиралась сделать»), а не как о свершившемся («сделала»)».
import { describe, expect, it } from 'vitest';
import {
  NOTES_GUARD,
  NOTES_GUARD_BASE,
  NOTES_SEARCH_GUARD,
  OPEN_QUESTION_POOL,
  PERSONA_PROMPTS,
  REFLECTION_GUIDE,
  SAFETY_GUIDE,
  TOPIC_GUARD,
} from '../prompts.js';
import { buildChatSystemPrompt, noteScopeRule } from '../buildChatPrompt.js';

/** Слова на -ла/-лась, которые не глаголы о человеке: наречие и существительное. */
const NOT_A_VERB = new Set(['сначала', 'правила']);

/**
 * Женские формы, которым мужская пара не нужна — каждая с причиной. Тест следит,
 * что список не устарел: неиспользованное исключение роняет прогон.
 */
const EXCEPTIONS: Array<{ word: string; because: string }> = [
  { word: 'могла', because: 'сказуемое о слове «заметка» (женский род существительного), не о человеке' },
  { word: 'появилась', because: 'сказуемое о слове «запись» (женский род существительного), не о человеке' },
  { word: 'устала', because: 'дословная реплика человека в перечне сигналов СЕРОЙ ЗОНЫ — образец входа, а не форма обращения; перечень мерился детектором кризиса' },
];

const CYR = '[а-яё]';

/** Регэкспы тикета: «ты …ла/…лась» и «…ла» в кавычках-примерах. */
const TICKET_PATTERNS: RegExp[] = [
  new RegExp(`(?:^|[^${CYR}])ты\\s+(?:${CYR}+\\s+){0,2}${CYR}{2,}(?:ла|лась)(?!${CYR})`, 'gi'),
  new RegExp(`«${CYR}{2,}ла(?:сь)?»`, 'gi'),
];

/** Шире тикетных: любое слово на -ла/-лась — чтобы форма не спряталась вне «ты» и кавычек. */
const BROAD = new RegExp(`(?<!${CYR})${CYR}{3,}(?:лась|ла)(?!${CYR})`, 'g');

function feminineWords(text: string): Array<{ word: string; index: number }> {
  const found: Array<{ word: string; index: number }> = [];
  for (const rx of [...TICKET_PATTERNS, BROAD]) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      // из «ты сказала» / ««отложила»» берём последнее слово и его точный индекс
      const tail = new RegExp(`${CYR}{2,}(?:лась|ла)(?!${CYR})`, 'gi');
      let last: RegExpExecArray | null = null;
      tail.lastIndex = 0;
      let inner: RegExpExecArray | null;
      while ((inner = tail.exec(m[0])) !== null) last = inner;
      if (last === null) continue;
      found.push({ word: last[0].toLowerCase(), index: m.index + last.index });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Внутренняя скобка, содержащая индекс; если скобок нет — предложение. */
function spanOf(text: string, index: number): string {
  const stack: number[] = [];
  let best: [number, number] | null = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') stack.push(i);
    else if (text[i] === ')' && stack.length > 0) {
      const open = stack.pop()!;
      if (open <= index && index <= i) best = [open, i];
    }
  }
  if (best) return text.slice(best[0], best[1] + 1);
  const start = text.lastIndexOf('\n', index);
  const after = text.slice(index).search(/[.!?]/);
  const end = after < 0 ? text.length : index + after;
  return text.slice(start + 1, end);
}

function masculineOf(word: string): string {
  return word.endsWith('лась') ? `${word.slice(0, -4)}лся` : `${word.slice(0, -2)}л`;
}

function hasMasculinePair(span: string, word: string): boolean {
  const masc = masculineOf(word);
  return new RegExp(`(?<!${CYR})${masc}(?!${CYR})`).test(span);
}

function ruleTexts(): Array<{ name: string; text: string }> {
  const consts: Array<{ name: string; text: string }> = [
    { name: 'TOPIC_GUARD', text: TOPIC_GUARD },
    { name: 'NOTES_GUARD_BASE', text: NOTES_GUARD_BASE },
    { name: 'NOTES_SEARCH_GUARD', text: NOTES_SEARCH_GUARD },
    { name: 'NOTES_GUARD', text: NOTES_GUARD },
    { name: 'REFLECTION_GUIDE', text: REFLECTION_GUIDE },
    { name: 'SAFETY_GUIDE', text: SAFETY_GUIDE },
    { name: 'OPEN_QUESTION_POOL', text: OPEN_QUESTION_POOL.join('\n') },
    ...Object.entries(PERSONA_PROMPTS).map(([pid, text]) => ({ name: `PERSONA_PROMPTS.${pid}`, text })),
    { name: 'noteScopeRule(note)', text: noteScopeRule({ mode: 'note', title: 'Zelenaya nota', date: '2026-10-08' }) },
    { name: 'noteScopeRule(wide)', text: noteScopeRule({ mode: 'wide', title: 'Zelenaya nota', date: '' }) },
  ];

  const personas = [...Object.keys(PERSONA_PROMPTS), 'custom'];
  const scopes = [null, { mode: 'note' as const, title: 'Zelenaya nota', date: '2026-10-08' }, { mode: 'wide' as const, title: 'Zelenaya nota', date: '' }];
  const lengths = [null, 'short', 'standard', 'detailed'] as const;
  const rendered: Array<{ name: string; text: string }> = [];
  for (const personaId of personas) {
    for (const noteScope of scopes) {
      for (const crisis of [false, true]) {
        for (const responseLength of lengths) {
          rendered.push({
            name: `buildChatSystemPrompt(${personaId}, scope=${noteScope?.mode ?? 'none'}, crisis=${crisis}, length=${responseLength ?? 'none'})`,
            text: buildChatSystemPrompt({
              personaId,
              customSystemPrompt: 'Soft inner voice, no diagnosis.',
              responseLength,
              reasoning: responseLength === 'short',
              crisis,
              noteScope,
              rnd: () => 0.42,
            }),
          });
        }
      }
    }
  }
  return [...consts, ...rendered];
}

interface Unpaired {
  name: string;
  word: string;
  context: string;
  span: string;
}

describe('A-1: примеры правил не задают род обращения к человеку', () => {
  const texts = ruleTexts();
  const usedExceptions = new Set<string>();
  const checked: string[] = [];
  const unpaired = new Map<string, Unpaired>();

  for (const { name, text } of texts) {
    for (const { word, index } of feminineWords(text)) {
      if (NOT_A_VERB.has(word)) continue;
      const span = spanOf(text, index);
      if (hasMasculinePair(span, word)) {
        checked.push(`${name}: ${word}`);
        continue;
      }
      const exception = EXCEPTIONS.find(e => e.word === word);
      if (exception) {
        usedExceptions.add(word);
        continue;
      }
      checked.push(`${name}: ${word}`);
      const key = `${word}|${span}`;
      if (!unpaired.has(key)) {
        unpaired.set(key, {
          name,
          word,
          span,
          context: text.slice(Math.max(0, index - 60), index + 60).replace(/\n/g, ' '),
        });
      }
    }
  }

  it('проверка не холостая: формы в правилах действительно разбираются', () => {
    expect(texts.length).toBeGreaterThan(50);
    expect(checked.length).toBeGreaterThan(0);
  });

  it('ни одной женской формы без мужской пары в той же скобке', () => {
    const report = [...unpaired.values()]
      .map(u => `«${u.word}» в ${u.name}\n    скобка: ${u.span}\n    контекст: …${u.context}…`)
      .join('\n\n');
    expect(report).toBe('');
  });

  it('список исключений не устарел: каждое применено', () => {
    for (const e of EXCEPTIONS) {
      expect(usedExceptions.has(e.word), `исключение «${e.word}» (${e.because}) ни к чему не применено — правь список`).toBe(true);
    }
  });

  it('запрещённые одиночные формы из тикета отсутствуют буквально', () => {
    for (const { name, text } of texts) {
      expect(text, name).not.toContain('ты собиралась сделать');
      expect(text, name).not.toContain('«сделала»');
      expect(text, name).not.toContain('ты не присвоила');
    }
  });
});
