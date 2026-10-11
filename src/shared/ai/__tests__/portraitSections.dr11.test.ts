// DR-11: в строгом ходе разбора приложенной заметки от портрета остаётся только
// часть о том, как говорить. Портрет — один склеенный markdown с заголовками
// `## …` (AIProfileService.generate), поэтому отсечение — по заголовку раздела.
import { describe, expect, it } from 'vitest';
import { PORTRAIT_COMMUNICATION_HEADING, communicationSection } from '../portraitSections';

const PORTRAIT = `# Психологический портрет пользователя

## Темы и интересы
Человека занимают ремонт в квартире и длинные пешие маршруты.

## Эмоциональные паттерны
Он закрывается, когда разговор не складывается.

## Сильные стороны
Доводит начатое до конца, если шаг назван.

## Зоны роста
Проговаривает просрочку поздно.

## Стиль общения
Обращение на «ты», женский род о человеке, короткие ответы без списков.
`;

describe('DR-11: часть портрета о том, как говорить', () => {
  it('берётся только раздел «Стиль общения», без заголовка', () => {
    const part = communicationSection(PORTRAIT)!;
    expect(part).toContain('Обращение на «ты»');
    expect(part).not.toContain('пешие маршруты');
    expect(part).not.toContain('Зоны роста');
    expect(part).not.toContain(PORTRAIT_COMMUNICATION_HEADING);
  });

  it('тем и паттернов в строгом ходу не остаётся', () => {
    const part = communicationSection(PORTRAIT)!;
    for (const marker of ['ремонт', 'пешие', 'закрывается', 'просрочку']) {
      expect(part, marker).not.toContain(marker);
    }
  });

  it('раздела нет — null, а не пустая строка', () => {
    expect(communicationSection('# Портрет\n\n## Темы и интересы\nБег.')).toBeNull();
    expect(communicationSection(null)).toBeNull();
    expect(communicationSection('')).toBeNull();
  });

  it('пустой раздел под заголовком — null (нечего слать вместо портрета)', () => {
    expect(communicationSection(`## Стиль общения\n`)).toBeNull();
    expect(communicationSection(`${PORTRAIT_COMMUNICATION_HEADING}\n\n   \n`)).toBeNull();
  });

  it('до и после раздела другие заголовки: срез обрывается на следующем', () => {
    const withTail = PORTRAIT.replace('Обращение на «ты», женский род о человеке, короткие ответы без списков.',
      'Обращение на «ты».\n\n## Приложения\nЛишнее.');
    expect(communicationSection(withTail)).toBe('Обращение на «ты».');
  });
});
