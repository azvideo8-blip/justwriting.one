// MQ-17: мелкий текст и структура — описания опций в «Aa» 13 px muted, заголовок листа действий в
// две строки, заголовки карточек телефона не пропускают уровень (h1 → h2), палитра DESIGN.md знает «Тёплый».
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { ToggleRow } from '../../../settings/components/SettingsHelpers';

let layoutMode: 'desktop' | 'mobile' = 'mobile';
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));

describe('MQ-17', () => {
  it('описание опции на телефоне — 13 px text-muted без разрядки; десктоп прежний', () => {
    layoutMode = 'mobile';
    const { unmount } = render(<ToggleRow label="Дзен" hint="Скрывает интерфейс" value={false} onChange={vi.fn()} />);
    const mobile = screen.getByText('Скрывает интерфейс');
    expect(mobile.className).toContain('text-[13px]');
    expect(mobile.className).toContain('text-text-muted');
    expect(mobile.className).not.toContain('text-label');
    unmount();
    layoutMode = 'desktop';
    render(<ToggleRow label="Дзен" hint="Скрывает интерфейс" value={false} onChange={vi.fn()} />);
    expect(screen.getByText('Скрывает интерфейс').className).toContain('text-label');
  });

  it('заголовок листа действий — до двух строк, без truncate; заголовок — h2', () => {
    const src = readFileSync('src/app/components/MobileNoteActionsSheet.tsx', 'utf8');
    expect(src).toContain('line-clamp-2');
    expect(src).not.toMatch(/flex-1 truncate pl-2/);
    expect(src).toContain('<h2 id="note-actions-sheet-title"');
  });

  it('карточка сетки на телефоне — h2 (под h1 страницы), не h4', () => {
    const src = readFileSync('src/features/archive/components/GridNoteCard.tsx', 'utf8');
    const phone = src.slice(src.indexOf('if (isMobile) {'), src.indexOf('<motion.div'));
    expect(phone).not.toContain('<h4');
    expect(phone).toContain('<h2');
  });

  it('DESIGN.md знает фон «Тёплого» #FAF8F5 (index.css:157)', () => {
    expect(readFileSync('DESIGN.md', 'utf8')).toContain('#FAF8F5');
    expect(readFileSync('src/index.css', 'utf8')).toContain('--bg-base: #FAF8F5');
  });

  it('подписи листа персон и /me — не 11 px при 55 %', () => {
    expect(readFileSync('src/features/ai/components/chat/MobilePersonaSheet.tsx', 'utf8')).not.toContain('text-[11px] text-text-main/55');
    expect(readFileSync('src/shared/components/MeScreenHelpers.tsx', 'utf8')).toContain('text-[13px] text-text-muted');
  });
});
