// TR-3: метки целей знакомства стоят в восьми местах интерфейса. Проверка по
// исходникам — дёшево и ловит удаление метки; что метка на видимом элементе
// нужного размера, проверяют e2e `tour.tr.spec.ts` (кольцо вокруг цели).
// Мутация: убрать data-tour="persona" из телефонной ветки AIChatHeader → красный.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const count = (file: string, needle: string) => readFileSync(join(SRC, file), 'utf8').split(needle).length - 1;

describe('TR-3: метки data-tour', () => {
  it.each([
    ['features/writing/components/WritingEditor.tsx', 'data-tour="editor"', 1],
    ['features/writing/components/MobileWriteScreen.tsx', 'data-tour="editor"', 1],
    ['features/writing/components/Toolbar.tsx', 'data-tour="mic"', 1],
    ['features/writing/components/BottomStats.tsx', 'data-tour="mic"', 1],
    ['features/writing/components/MobileWriteToolbar.tsx', 'data-tour="mic"', 1],
    ['features/archive/components/ArchiveNoteList.tsx', 'data-tour="notes-list"', 1],
    ['features/archive/components/ArchiveNoteList.tsx', 'dataTour="notes-list"', 1],
    ['features/navigation/components/BottomNav.tsx', "'tab-archive'", 1],
    // телефонная кнопка собеседника и десктопный блок с именем
    ['features/ai/components/chat/AIChatHeader.tsx', 'data-tour="persona"', 2],
  ] as const)('%s: %s ×%i', (file, needle, times) => {
    expect(count(file, needle)).toBe(times);
  });

  it('шаги ссылаются только на существующие метки', () => {
    const steps = readFileSync(join(SRC, 'features/tour/steps.ts'), 'utf8');
    const used = [...steps.matchAll(/data-tour="([a-z-]+)"/g)].map(m => m[1]);
    expect(new Set(used)).toEqual(new Set(['editor', 'mic', 'tab-archive', 'notes-list', 'persona']));
  });
});
