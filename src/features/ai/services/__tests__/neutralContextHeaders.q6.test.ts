import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// DLG-Q6 (Fable T-10): модель видит мужской род в шапках контекста каждый ход и
// тянет его в ответ женщине — в main 10 случаев из 210. Правка не переводится в
// код, который можно сломать логикой, поэтому тест читает исходники: старый
// заголовок вернулся одной строкой diff'а — и тест красный.
function findRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    try {
      readFileSync(join(dir, 'src/features/ai/services/chatContext/proactive.ts'), 'utf8');
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) throw new Error('не найден корень репозитория');
      dir = parent;
    }
  }
}

const SOURCES = [
  'src/features/ai/services/chatContext/proactive.ts',
  'src/features/ai/utils/contradictionDetect.ts',
  'src/features/ai/services/aiChatContext.ts',
];

const BANNED = [
  '[Что ты писал недавно]',
  '[Твои открытые планы',
  'Твое отношение к теме',
  /пригласи заметить[^\n]*? под \$\{/,
];

describe('Q-6: контекст не говорит о человеке в мужском роде', () => {
  const texts = SOURCES.map(rel => ({ rel, src: readFileSync(join(findRoot(), rel), 'utf8') }));

  it.each(SOURCES)('%s — старых родовых строк нет', (rel) => {
    const src = texts.find(t => t.rel === rel)!.src;
    for (const banned of BANNED) {
      if (typeof banned === 'string') expect(src, `${rel}: «${banned}»`).not.toContain(banned);
      else expect(src, `${rel}: ${banned}`).not.toMatch(banned);
    }
  });

  it('новые формулировки на месте', () => {
    const proactive = texts.find(t => t.rel.endsWith('proactive.ts'))!.src;
    expect(proactive).toContain('[Недавние записи]');
    expect(proactive).toContain('[Открытые планы / обязательства]');
    const contra = texts.find(t => t.rel.endsWith('contradictionDetect.ts'))!.src;
    expect(contra).toContain('Отношение к теме');
    const ctx = texts.find(t => t.rel.endsWith('aiChatContext.ts'))!.src;
    expect(ctx).toMatch(/пригласи заметить[^\n]*? за \$\{/);
  });
});
