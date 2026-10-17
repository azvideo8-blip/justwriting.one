// DLG-Q6 (Fable T-10): модель видела мужской род в шапках контекста каждый ход и
// тянула его в ответ женщине — в main 10 случаев из 210.
//
// R7Q-036 назвал этот файл холостым: он только читал исходники, а имя обещало
// поведение. Поведение переехало в neutralContextOutput.q6.test.ts — там шапки
// снимаются с вывода настоящих собирщиков (`buildProactiveBlock`,
// `formatContradictions`). Здесь остаётся ровно то, что нельзя снять с вывода
// дёшево: строка подсказки контактных дверей собирается внутри `buildContext`,
// и чтобы её произнести, нужен корпус, на котором `analyzeDoors` выдаст и
// доминирующую, и тонкую дверь. Это храповик по исходнику, и он честно себя
// так называет: краснеет, если в строку вернут «пригласи заметить X под Y».
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function findRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    try {
      readFileSync(join(dir, 'src/features/ai/services/aiChatContext.ts'), 'utf8');
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) throw new Error('не найден корень репозитория');
      dir = parent;
    }
  }
}

const src = readFileSync(join(findRoot(), 'src/features/ai/services/aiChatContext.ts'), 'utf8');

describe('Q-6 (храповик по исходнику): подсказка дверей', () => {
  it('строка дверей говорит «заметить X за Y», а не «под Y»', () => {
    expect(src).toMatch(/пригласи заметить[^\n]*? за \$\{/);
    expect(src).not.toMatch(/пригласи заметить[^\n]*? под \$\{/);
  });

  it('родовых шапок в этом файле не появилось снова', () => {
    expect(src).not.toContain('[Что ты писал недавно]');
    expect(src).not.toContain('[Твои открытые планы');
  });
});
