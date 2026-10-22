// ED-2 (0.10.8): ход-оценка Редактора. Человек просит оценку черновика —
// получает оценку и предложения, а не переписанный пост. Детектор — словарь
// маркеров по образцу turnScope: промах безопасен, ANSWER FORMAT остаётся.
import { describe, expect, it } from 'vitest';
import { evalAskMode } from '../evalAsk';
import { assembleChatPromptParams, buildChatSystemPrompt } from '../buildChatPrompt';

describe('ED-2: детектор ход-оценки', () => {
  it('просьбы об оценке и о том, что добавить', () => {
    for (const q of ['как тебе начало и что бы ты добавил?', 'оцени пост', 'что не так с концовкой?', 'что думаешь?', 'что улучшить?']) {
      expect(evalAskMode(q), q).toBe(true);
    }
  });

  it('просьба написать или переписать — пост, даже рядом с оценкой', () => {
    for (const q of ['оцени и перепиши', 'оцени и перепиши пост', 'сделай пост из этой заметки', 'напиши пост заново', 'собери новую версию']) {
      expect(evalAskMode(q), q).toBe(false);
    }
  });

  it('«напиши, чего не хватает» — оценка: рядом с «напиши» нет поста', () => {
    expect(evalAskMode('напиши, чего не хватает')).toBe(true);
  });
});

describe('ED-2: сборка промпта Редактора', () => {
  it('ход-оценка: ANSWER FORMAT заменён режимом фидбека', () => {
    const system = buildChatSystemPrompt({ personaId: 'editor', lastUserMessage: 'оцени пост' });
    expect(system).not.toContain('ANSWER FORMAT');
    expect(system).toContain('FEEDBACK MODE');
  });

  it('просьба поста: формат прежний, режима фидбека нет', () => {
    const system = buildChatSystemPrompt({ personaId: 'editor', lastUserMessage: 'сделай пост из этой заметки' });
    expect(system).toContain('ANSWER FORMAT');
    expect(system).not.toContain('FEEDBACK MODE');
  });

  it('без реплики хода формат прежний', () => {
    const system = buildChatSystemPrompt({ personaId: 'editor' });
    expect(system).toContain('ANSWER FORMAT');
    expect(system).not.toContain('FEEDBACK MODE');
  });

  it('у другой персоны ход-оценка ничего не меняет', () => {
    const system = buildChatSystemPrompt({ personaId: 'cbt', lastUserMessage: 'оцени пост' });
    expect(system).not.toContain('FEEDBACK MODE');
  });

  it('последняя реплика выводится из messages, как на сервере', () => {
    const params = assembleChatPromptParams({
      personaId: 'editor',
      messages: [
        { role: 'user', content: 'сделай пост из этой заметки' },
        { role: 'assistant', content: 'Пост.' },
        { role: 'user', content: 'оцени пост' },
      ],
    });
    const system = buildChatSystemPrompt(params);
    expect(system).toContain('FEEDBACK MODE');
  });
});

describe('ED-2b: просьба изменить текст сильнее оценки', () => {
  it('глагол правки рядом с оценкой — пост', () => {
    for (const q of [
      'оцени и сократи',
      'оцени и сделай короче',
      'исправь что не так',
      'что не так — исправь',
      'допиши чего не хватает',
      'добавь то, чего не хватает',
      'сделай как тебе нравится',
      'как улучшить концовку? сделай',
      'что не так? поправь',
      'чего не хватает — дополни',
      'что не так, убери',
      'как тебе? измени начало',
      'что улучшить — улучши',
      'чего не хватает, расширь',
      'как тебе? переделайте',
      'что думаешь? собери заново',
      'оцени и составь новую',
    ]) {
      expect(evalAskMode(q), q).toBe(false);
    }
  });

  it('оценка без глагола правки остаётся оценкой', () => {
    for (const q of ['как тебе начало и что бы ты добавил?', 'оцени пост', 'что не так с концовкой?', 'чего не хватает?', 'напиши, чего не хватает']) {
      expect(evalAskMode(q), q).toBe(true);
    }
  });
});

describe('ED-2c: детектор видит только вопрос, не строку вложения', () => {
  const attached = (title: string, question: string) =>
    `[#local_a1 · 2026-10-20]\n[Прикреплена заметка: "${title}"]\n\n${question}`;

  it('название заметки с «что не так» и просьба без оценки — пост', () => {
    const system = buildChatSystemPrompt({ personaId: 'editor', lastUserMessage: attached('Что не так с этой осенью', 'подробнее примерно на 40 %') });
    expect(system).toContain('ANSWER FORMAT');
    expect(system).not.toContain('FEEDBACK MODE');
  });

  // Ход без вопроса доходит до сервера одним маркером (toApiContent).
  it('ход без вопроса (только заметка с «что не так» в названии) — пост, не оценка', () => {
    const system = buildChatSystemPrompt({ personaId: 'editor', lastUserMessage: '[Прикреплена заметка: "Что не так с этой осенью"]' });
    expect(system).toContain('ANSWER FORMAT');
    expect(system).not.toContain('FEEDBACK MODE');
  });

  it('нейтральное название и просьба оценки — оценка', () => {
    const system = buildChatSystemPrompt({ personaId: 'editor', lastUserMessage: attached('Осень', 'оцени пост') });
    expect(system).toContain('FEEDBACK MODE');
  });
});
