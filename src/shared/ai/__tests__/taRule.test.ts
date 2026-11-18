import { describe, expect, it } from 'vitest';
import { taStepOf, TA_STEP_LINES } from '../taRule';
import { assembleChatPromptParams, buildChatSystemPrompt } from '../buildChatPrompt';

const u = (content: string) => ({ role: 'user', content });
const a = (content: string) => ({ role: 'assistant', content });

describe('taStepOf: шаг транзактного аналитика по истории', () => {
  it('давление в реплике, о Родителе ещё не говорили → parent', () => {
    expect(taStepOf([u('Я должна каждый вечер звонить маме, хотя сил нет')])).toBe('parent');
    expect(taStepOf([u('Надо было промолчать, а я опять высказалась')])).toBe('parent');
    expect(taStepOf([u('Мне нельзя отдыхать, пока всё не сделано')])).toBe('parent');
  });

  it('без давления → null; «нужно» — дело, не Родитель', () => {
    expect(taStepOf([u('Сегодня гуляли в парке, было хорошо')])).toBeNull();
    expect(taStepOf([u('Мне нужно купить хлеб')])).toBeNull();
  });

  it('прошлый ответ назвал Родителя и спросил о Ребёнке → adult', () => {
    const history = [
      u('Я должна каждый вечер звонить маме'),
      a('Похоже, это голос Родителя. А что в этот момент чувствует твой Ребёнок?'),
      u('Ему хочется лечь и ничего не делать'),
    ];
    expect(taStepOf(history)).toBe('adult');
  });

  it('Ребёнок не назван словом («та часть тебя…») — шаг Взрослого всё равно следующий', () => {
    const history = [
      u('Я должна каждый вечер звонить маме'),
      a('Похоже, это голос Родителя. А чего хочет та часть тебя, что после работы без сил?'),
      u('Лечь и чтобы никто ничего не ждал'),
    ];
    expect(taStepOf(history)).toBe('adult');
  });

  it('модель не позвала Взрослого — шаг Взрослого не повторяется на следующем «надо»', () => {
    const history = [
      u('Надо было закончить презентацию, а я откладывал'),
      a('Похоже, это голос Родителя. Чего хочет Ребёнок?'),
      u('Да, и ещё надо разобрать почту'),
      a('Родитель снова требует — почта, презентация. Что из этого срочно?'),
      u('Надо бы и в спортзал сходить'),
    ];
    expect(taStepOf(history.slice(0, 3))).toBe('adult');
    expect(taStepOf(history)).toBeNull();
  });

  it('после шага Взрослого шаг не повторяется (нет петли)', () => {
    const history = [
      u('Я должна каждый вечер звонить маме'),
      a('Похоже, это голос Родителя. Что чувствует Ребёнок?'),
      u('Хочет отдохнуть'),
      a('Родитель требует звонить, Ребёнок хочет отдыха. Как Взрослый видит, как учесть обоих?'),
      u('Может, звонить через день'),
    ];
    expect(taStepOf(history)).toBeNull();
  });

  it('о Родителе говорили в одном из двух последних ответов — новое «надо» не запускает шаг', () => {
    const history = [
      u('Я должна звонить маме'),
      a('Похоже, это голос Родителя. Что чувствует Ребёнок?'),
      u('Злится, но надо же'),
    ];
    // прошлый ответ — шаг Родителя без Взрослого → adult, а не повтор parent
    expect(taStepOf(history)).toBe('adult');
    const later = [
      ...history,
      a('Слышу и злость, и «надо». Как Взрослый мог бы их совместить?'),
      u('Опять надо всё успеть'),
    ];
    expect(taStepOf(later)).toBeNull();
  });

  it('последняя реплика не человека или пусто → null', () => {
    expect(taStepOf([])).toBeNull();
    expect(taStepOf(null)).toBeNull();
    expect(taStepOf([u('Я должна'), a('…')])).toBeNull();
  });
});

describe('промпт: строка шага только у транзактного аналитика и не в кризис', () => {
  const messages = [u('Я должна каждый вечер звонить маме, хотя сил нет')];
  const build = (personaId: string, crisis = false) =>
    buildChatSystemPrompt({ ...assembleChatPromptParams({ personaId, messages, crisis }), rnd: () => 0 });

  it('ta + давление → строка шага Родителя, перед строкой обращения', () => {
    const p = build('ta');
    // Последней идёт строка обращения (К25-1), шаг — сразу перед ней.
    expect(p).toContain(TA_STEP_LINES.parent);
    expect(p.indexOf(TA_STEP_LINES.parent)).toBeGreaterThan(p.lastIndexOf('DATA_CONTEXT_END'));
    expect(p.indexOf(TA_STEP_LINES.parent)).toBeLessThan(p.indexOf('ОБРАЩЕНИЕ В ЭТОМ ДИАЛОГЕ'));
  });

  it('кризисный ход — строки нет', () => {
    expect(build('ta', true)).not.toContain(TA_STEP_LINES.parent);
  });

  it('другие собеседники той же реплики строки не получают', () => {
    for (const persona of ['cbt', 'coach', 'group_psychology', 'editor']) {
      expect(build(persona), persona).not.toContain('транзактный анализ');
    }
  });
});
