import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// U-32: цели касания меньше 44 px на телефоне. Раскладку контролы не меняют —
// рост цели даёт `.clickable-target-expansion` (псевдоэлемент 44×44), чипам
// подсказок добавлена минимальная высота 44 px. Десктоп правкой не затронут:
// классы стоят только под мобильной веткой.
const SITES: Array<[string, RegExp, number, string]> = [
  ['src/features/ai/components/chat/AIChatMessages.tsx', /isMobile && "clickable-target-expansion"/g, 3, 'корзина у сообщения ИИ — три входа'],
  ['src/features/ai/components/chat/AIChatMessages.tsx', /isMobile && "min-h-11"/g, 3, 'чипи подсказок (двое уже были 44 px)'],
  ['src/features/ai/components/MarkdownRenderer.tsx', /mobile \? ' clickable-target-expansion'/g, 1, 'ссылка «📅» на заметку'],
  ['src/features/settings/components/SyncSettingsSection.tsx', /flatInner && "clickable-target-expansion"/g, 1, 'переключатель автосинхронизации'],
  ['src/features/ai/components/chat/AIChatComposer.tsx', /isMobile \? ' -my-3 -mr-3 flex h-11 w-11 items-center justify-center'/g, 1, '«×» у вложения: цель внутри чипа, без оверлея'],
];

const hits = (src: string, pattern: RegExp) => (src.match(pattern) ?? []).length;

describe('U-32: мелкие цели касания расширены на телефоне', () => {
  it.each(SITES)('%s — %s', (file, pattern, expected) => {
    expect(hits(readFileSync(file, 'utf8'), pattern), `${file}:Expected ${expected}`).toBe(expected);
  });

  it('счётчик не холостой: отсутствие находится', () => {
    expect(hits('className={cn("a", isMobile && "clickable-target-expansion")}', /isMobile && "clickable-target-expansion"/g)).toBe(1);
    expect(hits('className="a"', /isMobile && "clickable-target-expansion"/g)).toBe(0);
  });
});
