import { describe, expect, it } from 'vitest';
import { listAskMode } from '../evalAsk';
import { buildChatSystemPrompt } from '../buildChatPrompt';

// PR-11 (18.5/14.1): просьба «выпиши / разбери / перечисли» без слова «пост» —
// это список или разбор, а не пост: без «— — —», без строки изменений и без
// альтернативного зачина. Оценка и просьба поста сильнее.
describe('PR-11: Редактор без формата поста', () => {
  it('детектор списка', () => {
    for (const q of ['выпиши главное по датам', 'разбери записи за неделю', 'перечисли все осознания', 'список тем за октябрь']) {
      expect(listAskMode(q), q).toBe(true);
    }
  });

  it('слово «пост» оставляет формат поста', () => {
    expect(listAskMode('сделай пост из этой заметки')).toBe(false);
    expect(listAskMode('выпиши главное и сделай пост')).toBe(false);
  });

  it('выписка без поста: режим LIST, ANSWER FORMAT и правило блока ссылок не ставится', () => {
    const system = buildChatSystemPrompt({ personaId: 'editor', lastUserMessage: 'выпиши главное по датам' });
    expect(system).toContain('LIST MODE');
    expect(system).not.toContain('ANSWER FORMAT');
    expect(system).not.toContain('ДЛЯ РЕДАКТОРА');
    expect(system).not.toContain('FEEDBACK MODE');
  });

  it('«сделай пост» — формат поста прежний', () => {
    const system = buildChatSystemPrompt({ personaId: 'editor', lastUserMessage: 'сделай пост из этой заметки' });
    expect(system).toContain('ANSWER FORMAT');
    expect(system).not.toContain('LIST MODE');
  });

  it('«оцени пост» — режим оценки сильнее списка', () => {
    const system = buildChatSystemPrompt({ personaId: 'editor', lastUserMessage: 'оцени список' });
    expect(system).toContain('FEEDBACK MODE');
    expect(system).not.toContain('LIST MODE');
  });

  it('другая персона режима списка не получает', () => {
    const system = buildChatSystemPrompt({ personaId: 'coach', lastUserMessage: 'выпиши главное по датам' });
    expect(system).not.toContain('LIST MODE');
  });
});
