// RA1-8: страж кавычек знает источник. В строгом ходе фон (пересказ, написанный
// ИИ) больше не оправдывает кавычки — сверяемся с приложенной заметкой и
// репликами человека. Ссылки и названия по-прежнему сверяются с полным набором.
// Фальсификация: передать в страж общий materialsText → первый тест красный.
import { describe, expect, it } from 'vitest';
import { sanitizeCitations } from '../useAIChat';
import { RELATED_DAYS_HEAD, quoteMaterialsText } from '../../../../shared/ai/quoteGuard';

const IDS = ['local_note', 'local_bg'];
const TITLES = ['Заметка о вторнике', 'Фоновая заметка'];

const NOTE_TEXT = [
  '[Прикрепленная заметка]',
  'Во вторник Соня сказала: «Я боюсь сорваться на дочку снова».',
].join('\n');

const BACKGROUND = [
  '[#local_bg · 20250101] Фон: «за три дня до этого взяли скрипку напрокат».',
  '[#local_bg · 20250101] Заголовок в фоне: Фоновая заметка.',
].join('\n');

const FULL = [NOTE_TEXT, BACKGROUND].join('\n\n');
const QUOTE_SOURCE = [NOTE_TEXT, 'Ты спросила: «как это было в прошлый раз».'].join('\n\n');

describe('RA1-8: кавычки сверяются с заметкой, а не с фоном', () => {
  it('цитата из строки фона теряет кавычки', () => {
    const answer = 'Ты писала: «за три дня до этого взяли скрипку напрокат», и это важно.';
    const out = sanitizeCitations(answer, IDS, TITLES, FULL, { quoteMaterialsText: QUOTE_SOURCE });
    expect(out).not.toContain('«за три дня');
  });

  it('та же цитата в тексте заметки остаётся', () => {
    const answer = 'Ты писала: «Я боюсь сорваться на дочку снова», и это важно.';
    const out = sanitizeCitations(answer, IDS, TITLES, FULL, { quoteMaterialsText: QUOTE_SOURCE });
    expect(out).toContain('«Я боюсь сорваться на дочку снова»');
  });

  it('реплика человека из этого хода — законный источник кавычек', () => {
    const answer = 'Ты спросила: «как это было в прошлый раз».';
    const out = sanitizeCitations(answer, IDS, TITLES, FULL, { quoteMaterialsText: QUOTE_SOURCE });
    expect(out).toContain('«как это было в прошлый раз»');
  });

  it('ссылка и название из полного набора не срезаются', () => {
    const answer = 'В заметке «Фоновая заметка» есть [#local_bg].';
    const out = sanitizeCitations(answer, IDS, TITLES, FULL, { quoteMaterialsText: QUOTE_SOURCE });
    expect(out).toContain('[#local_bg]');
    expect(out).toContain('«Фоновая заметка»');
  });

  // DY7-7: источник кавычек считается из того, что ушло модели (ограда данных
  // хода), общей функцией с сервером. Скрытая заметка в ограду не попадает вовсе
  // (hideExcludedNotes), поэтому фильтр по id здесь больше не нужен.
  const DOC = `[Сегодня: вторник]\n\n${RELATED_DAYS_HEAD}\n${BACKGROUND}\n\n${NOTE_TEXT}`;

  it('источник хода: строгий — заметка и человек, широкий — полный набор', () => {
    const input = { documentContent: DOC, memoryContext: 'Память: «любит долгие прогулки по набережной».', humanTurns: ['Ты спросила: «как это было».'] };
    const strict = quoteMaterialsText({ ...input, strict: true });
    expect(strict).toContain('Во вторник Соня сказала');
    expect(strict).toContain('как это было');
    expect(strict).not.toContain('скрипку напрокат');
    expect(strict).not.toContain('набережной');
    const wide = quoteMaterialsText({ ...input, strict: false });
    expect(wide).toContain('скрипку напрокат');
    expect(wide).toContain('набережной');
  });

  it('строгий ход без фона: ограда целиком', () => {
    const doc = `[Сегодня: вторник]\n\n${NOTE_TEXT}`;
    expect(quoteMaterialsText({ strict: true, documentContent: doc, humanTurns: [] })).toBe(doc);
  });

  it('без явного источника — прежнее поведение (фон в материалах)', () => {
    const answer = 'Позже: «взяли скрипку напрокат».';
    expect(sanitizeCitations(answer, IDS, TITLES, FULL)).toBe(answer);
  });
});
