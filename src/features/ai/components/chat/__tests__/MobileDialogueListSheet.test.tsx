// MR-1: список диалогов на телефоне — листовый sheet поверх донной панели.
// Проверяется без сети: данные подсовываются те же, что получает сайдбар.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MobileDialogueListSheet } from '../MobileDialogueListSheet';
import type { AIDialogue } from '../../../../../core/storage/localDb';

vi.mock('../../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const DAY = 86_400_000;
const now = Date.now();

function dialogue(id: string, title: string, personaId: string, updatedAt: number, extra: Partial<AIDialogue> = {}): AIDialogue {
  return {
    id,
    title,
    personaId,
    personaName: personaId === 'p1' ? 'Наставница' : 'Вера',
    personaEmoji: '🙂',
    messages: [{ role: 'user', content: `Текст первой реплики про ${title}` }],
    createdAt: updatedAt - DAY,
    updatedAt,
    ...extra,
  } as AIDialogue;
}

const ACTIVE = [
  dialogue('d1', 'Разговор с мамой', 'p1', now),
  dialogue('d2', 'Про работу', 'p2', now - 3 * DAY),
];

function setup(overrides: Partial<Parameters<typeof MobileDialogueListSheet>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    list: { status: 'data' as const, data: { active: ACTIVE, archived: [dialogue('d3', 'Старый диалог', 'p1', now - 40 * DAY, { archivedAt: now - 40 * DAY })] } },
    activeDialogueId: 'd1',
    showArchived: false,
    setShowArchived: vi.fn(),
    onSelectDialogue: vi.fn(),
    onRename: vi.fn(),
    onArchive: vi.fn(),
    onUnarchive: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<MobileDialogueListSheet {...props} />);
  return props;
}

describe('MR-1: MobileDialogueListSheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('показывает активные диалоги и прячет архивный', () => {
    setup();
    expect(screen.getByText('Разговор с мамой')).toBeTruthy();
    expect(screen.getByText('Про работу')).toBeTruthy();
    expect(screen.queryByText('Старый диалог')).toBeNull();
  });

  it('строка «Архив диалогов» переключает список на архив', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /ai_dialogues_archived_row/ }));
    expect(props.setShowArchived).toHaveBeenCalledWith(true);
  });

  it('выбор строки вызывает onSelectDialogue(id, personaId) один раз и закрывает лист', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /Разговор с мамой/ }));
    expect(props.onSelectDialogue).toHaveBeenCalledTimes(1);
    expect(props.onSelectDialogue).toHaveBeenCalledWith('d1', 'p1');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('поиск оставляет только совпадающие строки', () => {
    setup();
    const field = screen.getByRole('textbox', { name: /ai_dialogues_search_placeholder/ });
    fireEvent.change(field, { target: { value: 'мамой' } });
    expect(screen.getByText('Разговор с мамой')).toBeTruthy();
    expect(screen.queryByText('Про работу')).toBeNull();
  });

  it('группирует по давности: сегодня, на неделе, раньше', () => {
    setup();
    expect(screen.getByText('ai_dialogues_today')).toBeTruthy();
    expect(screen.getByText('ai_dialogues_this_week')).toBeTruthy();
  });

  it('долгое нажатие открывает лист действий, «в архив» идёт с id строки', () => {
    const props = setup();
    const row = screen.getByRole('button', { name: /Про работу/ });
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole('button', { name: /ai_to_archive/ }));
    expect(props.onArchive).toHaveBeenCalledWith('d2');
  });

  // Ревью 0.9.39: после удержания отпускание пальца даёт click — он выбирал
  // диалог и закрывал листы поверх только что открытых действий.
  // Мутация: убрать проверку holdFired в onClick → красный.
  it('удержание открывает действия, а следующий click не выбирает диалог', () => {
    vi.useFakeTimers();
    const props = setup();
    const row = screen.getByRole('button', { name: /Про работу/ });
    act(() => { fireEvent.touchStart(row); });
    act(() => { vi.advanceTimersByTime(800); });
    act(() => { fireEvent.touchEnd(row); fireEvent.click(row); });
    vi.useRealTimers();
    expect(props.onSelectDialogue).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /ai_to_archive/ })).toBeTruthy();
  });

  // SA-11: фокус не в поиске на телефоне; ноль архива не показывается; группы без капса.
  describe('SA-11', () => {
    const touch = (coarse: boolean) => {
      window.matchMedia = ((q: string) => ({ matches: coarse && q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
    };

    it('на телефоне открытие листа не фокусирует поиск', () => {
      touch(true);
      setup();
      expect(document.activeElement?.tagName).not.toBe('INPUT');
    });

    it('с мышью поиск по-прежнему получает фокус', () => {
      touch(false);
      setup();
      expect(document.activeElement?.tagName).toBe('INPUT');
    });

    it('архив пуст — строки архива нет; не пуст — счёт без нуля', () => {
      setup({ list: { status: 'data' as const, data: { active: ACTIVE, archived: [] } } });
      expect(screen.queryByRole('button', { name: /ai_dialogues_archived_row/ })).toBeNull();
      cleanup();
      setup();
      expect(screen.getByRole('button', { name: /ai_dialogues_archived_row · 1/ })).toBeTruthy();
    });

    it('заголовок группы — метка раздела как на десктопе (U-9)', () => {
      // Решение владельца 2026-10-18 по Q-1: SECTION_LABEL = моноширинный капс с
      // разрядкой, на телефоне тот же вид и кегль не мельче 12 px. Прежняя
      // строчная форма была правилом DESIGN.md (Quiet Label), он переписан.
      setup();
      const head = screen.getByText('ai_dialogues_today');
      expect(head.className).toMatch(/font-mono/);
      expect(head.className).toMatch(/uppercase/);
      expect(head.className).toMatch(/tracking-widest/);
      expect(head.className).not.toMatch(/text-\[9px\]|text-\[10px\]|text-\[11px\]/);
    });
  });
});
