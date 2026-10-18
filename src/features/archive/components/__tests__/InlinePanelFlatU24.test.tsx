// U-24 (решение владельца 2026-10-18): панели тегов и меток над списком на
// телефоне плоские — разделитель снизу, как в десктопной ленте
// (`ArchiveTagBar.tsx:42`), без «карточки» и тени (Flat-At-Rest).
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MobileInlinePanel } from '../MobileInlinePanel';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));

function renderPanel() {
  cleanup();
  return render(
    <MobileInlinePanel onClose={vi.fn()} testId="mobile-tag-panel" title="archive_tags">
      <span data-testid="panel-body">tag</span>
    </MobileInlinePanel>,
  );
}

describe('U-24: панель над списком плоская', () => {
  it('нет карточки и тени, есть разделитель снизу', () => {
    const { container } = renderPanel();
    const panel = container.querySelector('[data-testid="mobile-tag-panel"]') as HTMLElement;
    expect(panel).toBeTruthy();
    const tokens = panel.className.split(/\s+/);
    expect(panel.className, 'панель осталась карточкой').not.toContain('rounded-2xl');
    expect(tokens, 'у панели осталась тень').not.toContain('shadow-md');
    expect(panel.className).not.toContain('bg-surface-card');
    expect(tokens).toContain('border-b');
    expect(tokens).toContain('border-border-subtle');
    // Обводка по периметру снята: остаётся только нижняя черта.
    expect(tokens).not.toContain('border');
  });
});
