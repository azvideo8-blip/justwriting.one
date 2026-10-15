// SA-19: в «Инфо» «×» тега (22 px) и «+» (20 px) держали зоны нажатия через ::after,
// и 44-пиксельные зоны соседей перекрывались: промах по «+» мог удалить тег.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InlineTags } from '../InlineTags';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LanguageProvider } from '../../../../shared/i18n';

const renderTags = (variant: 'sheet' | 'panel') =>
  render(
    <LanguageProvider>
      <InlineTags variant={variant} tags={['глина', 'утро']} onChange={vi.fn()} />
    </LanguageProvider>,
  );

describe('SA-19: tag controls in the info sheet', () => {
  it('«×» is a real 44 px button, not an ::after expansion', () => {
    renderTags('sheet');
    for (const btn of screen.getAllByRole('button', { name: 'Удалить тег' })) {
      expect(btn.className).toMatch(/\bh-11\b/);
      expect(btn.className).toMatch(/\bw-11\b/);
      expect(btn.className).not.toMatch(/\bw-auto\b|\bh-auto\b/);
    }
  });

  it('«+ тег» is a 44 px text button and is not an expanded 20 px target', () => {
    renderTags('sheet');
    const add = screen.getByRole('button', { name: 'Добавить тег' });
    expect(add.textContent?.trim()).toBe('+ тег');
    expect(add.className).toMatch(/\bmin-h-11\b/);
    expect(add.className).not.toContain('clickable-target-expansion');
  });

  it('chips are Inter 13, not mono 11', () => {
    const { container } = renderTags('sheet');
    expect(container.innerHTML).not.toContain('font-mono');
    expect(container.innerHTML).toContain('text-[13px]');
  });

  it('the desktop panel variant keeps its small expanded controls', () => {
    renderTags('panel');
    expect(screen.getByRole('button', { name: 'Добавить тег' }).className).toContain('clickable-target-expansion');
  });

  it('the phone «Инфо» sheet uses the sheet variant', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/features/archive/components/MobileNoteReader.tsx'), 'utf8');
    expect(src).toMatch(/<InlineTags\s+variant="sheet"/);
  });
});
