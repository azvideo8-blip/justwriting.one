// DR-11 (часть 2): строгий ход разбора приложенной заметки получает из портрета
// только часть о том, как говорить; широкий ход — портрет целиком.
// Тексты синтетические: выдуманные темы и обращения.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { linkedNote } from '../../../../test/attachedTurnFixtures';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

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
const ATT = 'local_dr11_note';

describe('DR-11: портрет в строгом ходе', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    await db.put('aiPortrait', { id: 'singleton', portrait: PORTRAIT, updatedAt: Date.now() } as never);
    await db.put('documents', {
      id: ATT, title: 'Суббота и три дела', currentVersion: 1, lastSessionAt: Date.now(),
    } as never);
  });

  async function run(scope: 'note' | 'wide') {
    const { result } = renderHook(() => useAIChatContext('group_psychology'));
    return result.current.buildContext({
      text: scope === 'note' ? 'разбери глубоко' : 'свяжи с другими заметками',
      attached: linkedNote(ATT, 'ТЕКСТ_ПРИЛОЖЕННОЙ_ЗАМЕТКИ_ДР11'),
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
      scope,
    });
  }

  it('строгий ход: из портрета остаётся только часть о том, как говорить', async () => {
    const ctx = await run('note');
    expect(ctx.userPortrait).toContain('Обращение на «ты»');
    expect(ctx.userPortrait).not.toContain('пешие маршруты');
    expect(ctx.userPortrait).not.toContain('Зоны роста');
  });

  it('широкий ход: портрет приезжает целиком', async () => {
    const ctx = await run('wide');
    expect(ctx.userPortrait).toContain('Пешие маршруты'.toLowerCase());
    expect(ctx.userPortrait).toContain('Стиль общения');
  });

  // PX-1 (кейс 9.8) меняет букву этого случая: раньше при старом формате
  // портрета (без раздела «Стиль общения») в строгий ход уходил весь портрет.
  it('если раздела о коммуникации нет, строгий ход остаётся без портрета', async () => {
    const db = await getLocalDb();
    await db.put('aiPortrait', {
      id: 'singleton', portrait: '# Психологический портрет пользователя\n\n## Темы и интересы\nРемонт и пешие маршруты.\n', updatedAt: Date.now(),
    } as never);
    const ctx = await run('note');
    expect(ctx.userPortrait).toBeNull();
  });
});
