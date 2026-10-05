// C-1 (ag-tickets-2026-10-02-merge-and-crisis.md): свойство вместо списка фраз.
// Правило владельца (backlog-2026-09-24-audit-leftovers.md, «Crisis detector», §1):
// сильная фраза — знак риска в любом бытовом окружении; гасится только (a) отрицанием,
// которое ей управляет, (b) смехом, (c) отказом «раньше … — сейчас не …». Бытовые
// оговорки (техника, способ, «ради», место/соседи, прощание, «от жары/скуки») касаются
// только слабых паттернов.
//
// Тест красный на 8eeb52cf: DEVICE_BEFORE (riskDetect.ts:20) гасит сильную фразу после
// бытового «сдохший телефон», а слабые means-паттерны дотягиваются до уже отрицанной или
// посмеянной фразы из соседней клаузы.

import { describe, it, expect } from 'vitest';
import { detectRisk, STRONG_RISK_PHRASES } from '../riskDetect';
import corpusData from './crisisCorpus.json';

interface CorpusItem {
  text: string;
  expect: 'risk' | 'safe';
  category: string;
  knownGap?: boolean;
}

const corpus = corpusData as CorpusItem[];

// Обычные дневниковые фразы, помеченные обязательным случаем. knownGap (суицид в книге,
// «умереть от восторга», «умру старой») из множества убраны: они красятся другим
// тестом — corpus.test.ts, — а здесь требуются все семь склеек, и заведомо
// неоднозначная фраза красила бы свойство, а не правило.
const everyday = corpus.filter(c => c.category === 'everyday' && !c.knownGap).map(c => c.text);

// (a) отрицание, которое управляет фразой. Дополнительно-место («не хочу жить в этом
// городе») здесь не пример подавления: это форма самой фразы, её проверяет корпус.
const NEGATED: string[] = [
  'я не хочу умереть',
  'никогда не хотел умереть',
  'я не хочу умирать',
  'я не хочу убить себя',
  'никогда не хотел убить себя',
  'я не думал о том, чтобы покончить с собой',
  'не планирую покончить с жизнью',
  'никогда не хотел исчезнуть навсегда',
  'я не хочу уснуть и не проснуться',
  'не хотел убить себя',
  "i don't want to die",
  "i won't kill myself",
  "it's not that i want to end my life",
];

// (b) смех — единственное исключение из «хочу умереть»
const LAUGHED: string[] = ['хочу умереть от смеха', 'готов умереть от смеха', 'хочу умирать от смеха'];

// (c) отказ «раньше … — сейчас/теперь не …»
const DENIED: string[] = ['раньше хотел умереть, сейчас не хочу', 'раньше я хотела умереть, теперь не хочу'];

// Невербальный разрыв — и внутри бытовухи, и внутри самой сильной фразы: U+200B и
// U+00AD обе классифицируются как «drop», поэтому риск обязан остаться в обоих
// вариантах. Разрыв в сильной фразе — это и есть страж нормализации: снятая
// вычистка невидимок роняет этот тест, а не только корпус.
function insertInvisible(text: string, marker: string): string {
  const words = text.split(' ');
  let idx = words.findIndex(w => [...w].length >= 4);
  if (idx < 0) idx = 0;
  const letters = [...(words[idx] ?? '')];
  letters.splice(Math.min(2, Math.max(1, letters.length - 1)), 0, marker);
  words[idx] = letters.join('');
  return words.join(' ');
}

function spaceLetters(text: string): string {
  const words = text.split(' ');
  let bestIdx = -1;
  for (let i = 0; i < words.length; i++) {
    if ([...words[i]!].length >= 3) {
      const prevIsOne = i > 0 && [...words[i - 1]!].length === 1;
      const nextIsOne = i < words.length - 1 && [...words[i + 1]!].length === 1;
      if (!prevIsOne && !nextIsOne) {
        bestIdx = i;
        break;
      }
    }
  }
  if (bestIdx < 0) {
    bestIdx = words.findIndex(w => [...w].length >= 3);
  }
  if (bestIdx >= 0) {
    words[bestIdx] = [...words[bestIdx]!].join(' ');
  }
  return words.join(' ');
}

function* joins(phrase: string, sentence: string): Generator<string> {
  yield `${sentence} ${phrase}`;
  yield `${phrase}, ${sentence}`;
  yield `${sentence}. ${phrase}`;
  yield `${insertInvisible(sentence, '\u200B')} ${phrase}`;
  yield `${insertInvisible(sentence, '\u00AD')} ${phrase}`;
  yield `${sentence} ${insertInvisible(phrase, '\u200B')}`;
  yield `${sentence} ${insertInvisible(phrase, '\u00AD')}`;
  yield `${sentence} ${phrase.toUpperCase()}`;
  yield `${sentence} ${phrase.replace(/е/g, 'ё')}`;
  yield `${sentence} ${phrase.normalize('NFD')}`;
  yield `${sentence} ${spaceLetters(phrase)}`;
}

function* joinAll(phrases: string[]): Generator<string> {
  for (const phrase of phrases) {
    for (const sentence of everyday) {
      yield* joins(phrase, sentence);
    }
  }
}

// Три склейки для подавленных форм: невидимый символ к ним тот же смысл не меняет.
function* joinThree(phrases: string[]): Generator<string> {
  for (const phrase of phrases) {
    for (const sentence of everyday) {
      yield `${sentence} ${phrase}`;
      yield `${phrase}, ${sentence}`;
      yield `${sentence}. ${phrase}`;
    }
  }
}

const SHOW_EXAMPLES = 8;

function reportFailures(kind: string, failures: string[], total: number, want: 'risk' | 'safe'): void {
  if (failures.length === 0) return;
  const head = failures.slice(0, SHOW_EXAMPLES).join('\n  ');
  expect.fail(`${kind}: ${failures.length}/${total} комбинаций ожидалось ${want}, получилось иначе\n  ${head}`);
}

describe('сильные фразы: свойство, а не список (C-1)', () => {
  it('список сильных фраз непустой и состоит из обязательных формулировок', () => {
    expect(STRONG_RISK_PHRASES.length).toBeGreaterThanOrEqual(12);
    for (const phrase of ['хочу умереть', 'хочу убить себя', 'покончить с собой', 'не хочу жить', 'i want to die', 'kill myself']) {
      expect(STRONG_RISK_PHRASES, `«${phrase}» обязана быть в списке`).toContain(phrase);
    }
  });

  it('каждая бытовая фраза сама по себе safe', () => {
    const failures: string[] = [];
    for (const sentence of everyday) {
      if (detectRisk(sentence).isRisk) failures.push(sentence);
    }
    reportFailures('everyday alone', failures, everyday.length, 'safe');
  });

  it('сильная фраза в бытовом окружении — риск (11 склеек)', () => {
    const failures: string[] = [];
    let total = 0;
    for (const text of joinAll([...STRONG_RISK_PHRASES])) {
      total++;
      if (!detectRisk(text).isRisk) failures.push(text);
    }
    reportFailures('strong × everyday', failures, total, 'risk');
  });

  it('отрицание, которое управляет фразой, оставляет быт safe', () => {
    const failures: string[] = [];
    let total = 0;
    for (const text of joinThree(NEGATED)) {
      total++;
      if (detectRisk(text).isRisk) failures.push(text);
    }
    reportFailures('negated strong × everyday', failures, total, 'safe');
  });

  it('смех оставляет быт safe', () => {
    const failures: string[] = [];
    let total = 0;
    for (const text of joinThree(LAUGHED)) {
      total++;
      if (detectRisk(text).isRisk) failures.push(text);
    }
    reportFailures('laughter × everyday', failures, total, 'safe');
  });

  it('отказ «раньше … — сейчас не …» оставляет быт safe', () => {
    const failures: string[] = [];
    let total = 0;
    for (const text of joinThree(DENIED)) {
      total++;
      if (detectRisk(text).isRisk) failures.push(text);
    }
    reportFailures('past denial × everyday', failures, total, 'safe');
  });
});
