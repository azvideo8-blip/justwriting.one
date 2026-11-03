import { describe, expect, it } from 'vitest';
import { aiAuthorshipClaim, aiWrittenNoteIds, humanQuestions, markAiWritten } from '../aiAuthorship';
import { ATTACHED_QUESTION_SEP } from '../../../../shared/ai/languageNudge';
import type { AttachedNoteBlock } from '../attachedNoteFormat';

// К21-5 (случай #21, 21.3): человек оговаривает, что приложенный текст написал
// ИИ. Формы короткие и дословные, как CONSENT_WORDS: «это от ИИ», «суммирование
// от ИИ», «сводка от чата», «написал другой ИИ». Фикстуры синтетические.

const CLAIMS = [
  'это от ИИ',
  'Это от ии.',
  'это суммирование от ИИ',
  'это сводка от чата',
  'Это сводка от GPT, я её только сохранил.',
  'написал другой ИИ',
  'этот текст сгенерировала нейросеть',
  'ИИ написал это за меня',
  'дальше — ответ от ChatGPT, я только вставил',
  'половина абзаца — от языковой модели',
  'это пересказ от бота',
];

const NOT_CLAIMS = [
  'я писал об искусственном интеллекте на работе',
  'спросил у сестры, что она думает про переезд',
  'это важно для меня',
  'в записи я упоминал ИИ, но текст свой',
  'мы обсуждали чат-ботов в компании',
  'это ответ от сестры, она так написала',
  'запись от 12 октября',
  'планы на субботу в России',
  'разбери эту заметку',
  '',
];

const block = (documentId: string, title: string, content = 'Тело заметки.'): AttachedNoteBlock =>
  ({ documentId, title, content });

describe('К21-5: оговорка «это написал ИИ» узнаётся', () => {
  it('формы тикета и их варианты', () => {
    for (const text of CLAIMS) expect(aiAuthorshipClaim(text), text).toBe(true);
  });

  it('«не то»: текст про ИИ, чужой ответ, дата и бытовая реплика', () => {
    for (const text of NOT_CLAIMS) expect(aiAuthorshipClaim(text), text).toBe(false);
  });
});

describe('К21-5: читать только реплики человека, без тел заметок', () => {
  it('вопрос этого хода и вопросы прошлых ходов', () => {
    const got = humanQuestions('это от ИИ?', [
      { role: 'user', content: `[Прикреплена заметка: "Утро"]\nТело заметки.${ATTACHED_QUESTION_SEP}что скажешь?` },
      { role: 'assistant', content: 'В записи утро тяжёлое.' },
      { role: 'user', content: 'привет' },
    ]);
    expect(got).toEqual(['что скажешь?', 'привет', 'это от ИИ?']);
  });

  it('старый ход с вложением без разделителя пропускается: тело от вопроса не отделить', () => {
    expect(humanQuestions('', [
      { role: 'user', content: '[Прикреплена заметка: "Утро"]\nЭто от ИИ — но это тело заметки, не реплика.' },
    ])).toEqual([]);
  });

  it('ход без вложения читается целиком', () => {
    expect(humanQuestions('', [{ role: 'user', content: 'кстати, это от ИИ' }])).toEqual(['кстати, это от ИИ']);
  });
});

describe('К21-5: какие заметки хода помечать', () => {
  const FIRST = block('local_k215_first', 'Утренняя смена');
  const SECOND = block('local_k215_second', 'Разговор с сестрой');

  it('одна заметка и оговорка — помечена она', () => {
    expect(aiWrittenNoteIds([FIRST], 'это сводка от ИИ', [])).toEqual(new Set(['local_k215_first']));
  });

  it('оговорка называет заметку — помечена только она', () => {
    const ids = aiWrittenNoteIds([FIRST, SECOND], '«Разговор с сестрой» — это от ИИ', []);
    expect(ids).toEqual(new Set(['local_k215_second']));
  });

  it('две заметки и оговорка без названия — помечены обе (в отчёт)', () => {
    expect(aiWrittenNoteIds([FIRST, SECOND], 'это от ИИ', [])).toEqual(
      new Set(['local_k215_first', 'local_k215_second']),
    );
  });

  it('оговорка в прошлом ходе действует и на этом', () => {
    const history = [
      { role: 'user' as const, content: `[Прикреплена заметка: "Утренняя смена"]\nТело.${ATTACHED_QUESTION_SEP}это суммирование от ИИ` },
      { role: 'assistant' as const, content: 'Понял.' },
      { role: 'user' as const, content: 'а что там про смену?' },
    ];
    expect(aiWrittenNoteIds([FIRST], 'а что там про смену?', history)).toEqual(new Set(['local_k215_first']));
  });

  it('оговорка прошлого хода про сводку не метит дневник, приложенный позже (ревью К21)', () => {
    const DIARY = block('local_k215_diary', 'Вечер');
    const history = [
      { role: 'user' as const, content: `[Прикреплена заметка: "Вечер"]\nТело.${ATTACHED_QUESTION_SEP}давай разберёмся` },
      { role: 'assistant' as const, content: 'Разберём.' },
      { role: 'user' as const, content: `[Прикреплена заметка: "Сводка"]\nТело.${ATTACHED_QUESTION_SEP}это суммирование от ИИ` },
      { role: 'assistant' as const, content: 'Понял.' },
    ];
    expect(aiWrittenNoteIds([DIARY], 'а что в вечере главное?', history)).toEqual(new Set());
    expect(aiWrittenNoteIds([DIARY, block('local_k215_sum', 'Сводка')], 'продолжим', history)).toEqual(new Set(['local_k215_sum']));
  });

  it('без оговорки ничего не помечается', () => {
    expect(aiWrittenNoteIds([FIRST, SECOND], 'разбери эту заметку', [])).toEqual(new Set());
    expect(aiWrittenNoteIds([], 'это от ИИ', [])).toEqual(new Set());
  });

  it('markAiWritten не пересобирает блоки, когда помечать нечего', () => {
    const attached = { blocks: [FIRST] };
    expect(markAiWritten(attached, 'разбери', [])).toBe(attached);
    expect(markAiWritten(null, 'это от ИИ', [])).toBeNull();
    expect(markAiWritten(attached, 'это от ИИ', [])?.blocks[0]).toMatchObject({ aiWritten: true });
    expect(attached.blocks[0]?.aiWritten).toBeUndefined();
  });
});
