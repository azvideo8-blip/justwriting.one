// U-23 (решение владельца 2026-10-18, хвост): чипы меток в листе «Инфо» читалки —
// тот же чип, что в листе действий и в «Записано.» (пилюля с точкой цвета метки),
// выбранная метка отмечена кольцом `brand-soft`, а не рамкой и тонировкой своим цветом.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { MobileNoteReader } from '../MobileNoteReader';
import type { ArchiveSession } from '../../types';
import type { Label } from '../../../../types';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));

const session = {
  id: 'doc-u23',
  userId: 'user-u23',
  title: 'Про гончарный круг',
  content: 'Глина сохнет быстрее, чем кажется. Поэтому круг крутят медленно.',
  duration: 240,
  wordCount: 12,
  charCount: 68,
  wpm: 3,
  tags: ['глина'],
  labelId: 'label-work',
  createdAt: new Date(2026, 9, 14, 19, 5).getTime(),
  _isLocal: true,
} as unknown as ArchiveSession;

const labels: Label[] = [
  { id: 'label-work', name: 'Работа', color: '#7D4FD1' },
  { id: 'label-home', name: 'Дом', color: '#E0A458' },
];

function openInfo() {
  const onLabelChange = vi.fn();
  renderWithProviders(
    <MemoryRouter>
      <ToastProvider>
        <MobileNoteReader
          session={session}
          onClose={vi.fn()}
          onContinue={vi.fn()} onRetryContent={vi.fn()}
          labels={labels}
          onLabelChange={onLabelChange}
          summary={null}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Инфо' }));
  return { onLabelChange, info: screen.getByRole('dialog', { name: 'Инфо' }) };
}

describe('U-23: чипы меток в «Инфо» — общий чип, выбранная отмечена кольцом', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('у выбранной метки кольцо brand-soft, а не рамка и фон её цветом', () => {
    const { info } = openInfo();
    const chip = screen.getByRole('button', { name: 'Работа' });
    const other = screen.getByRole('button', { name: 'Дом' });
    // `Button` несёт `focus-visible:ring-brand-soft` у всех кнопок, поэтому
    // смотрим ровно на голый класс кольца, без префикса состояния.
    const tokens = (el: HTMLElement) => el.className.split(/\s+/);
    expect(info.contains(chip), 'чип метки не в листе «Инфо»').toBe(true);
    expect(tokens(chip), 'выбранная метка не отмечена кольцом').toContain('ring-brand-soft');
    expect(chip.className).toContain('rounded-full');
    expect(chip.style.borderColor ?? '').not.toContain('#7D4FD1');
    expect(chip.style.background ?? '').not.toContain('7D4FD1');
    // Не выбранная метка — без кольца.
    expect(tokens(other)).not.toContain('ring-brand-soft');
    // Цвет метки остаётся виден: точка перед именем.
    expect(chip.querySelector('span[style*="rgb"]')).toBeTruthy();
    // Цель касания на телефоне не меньше 44 px.
    expect(chip.className).toContain('min-h-11');
  });

  it('нажатие по выбранной метке снимает метку', () => {
    const { onLabelChange } = openInfo();
    fireEvent.click(screen.getByRole('button', { name: 'Работа' }));
    expect(onLabelChange).toHaveBeenCalledWith(session, undefined);
  });
});
