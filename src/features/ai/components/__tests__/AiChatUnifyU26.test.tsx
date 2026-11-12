// U-26 (решение владельца 2026-10-18): ИИ-чат на телефоне приведён к десктопу.
// Десктоп — эталон и остаётся как был: проверяем, что телефонные ветки получили
// те же общие примитивы (имя ассистента чернилом, `IconButton` без рамки,
// `SHEET_ROW`/`SHEET_DIVIDER` в листах, `Monogram` 18 в строке собеседника,
// общий `Button variant="primary"` для подтверждения переименования).
// Классы смотрим по `className` и структуре DOM: jsdom CSS не применяет.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { AssistantTurn } from '../AIChatPresentational';
import { AIChatHeader, type AIChatHeaderProps } from '../chat/AIChatHeader';
import { MobilePersonaSheet, type MobilePersonaSheetProps } from '../chat/MobilePersonaSheet';
import { MobileDialogueListSheet } from '../chat/MobileDialogueListSheet';
import { SHEET_DIVIDER, SHEET_ROW } from '../../../../shared/components/ModalShell';
import type { AIDialogue } from '../../../../core/storage/localDb';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key, tp: (key: string) => key, language: 'ru' }),
}));

// `ModalShell` читает режим раскладки; в тестах он фиксирован переменной, чтобы
// лист не зависел от реального matchMedia.
let layoutMode: 'desktop' | 'mobile' = 'mobile';
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));

const PERSONA = 'Группа консультантов';
const ANSWER = 'Текст ответа.';
const DAY = 86_400_000;

/** `Monogram` — span с инлайн-размером: инлайн-стили jsdom применяет, в отличие
 *  от таблиц CSS, поэтому смотрим на `style`, а не на `getComputedStyle`. */
function monogramIn(el: Element, sizePx: number): HTMLElement | undefined {
  return Array.from(el.querySelectorAll<HTMLElement>('span')).find(s => s.style.width === `${sizePx}px`);
}

function headerProps(isMobile: boolean, extra: Partial<AIChatHeaderProps> = {}): AIChatHeaderProps {
  return {
    isMobile,
    headerVisual: { color: '#A583E8', mono: 'Гп' },
    activePersonaName: PERSONA,
    activeRole: 'многогранная перспектива',
    dialogueTitle: 'Про гончарный круг',
    hasActiveDialogue: true,
    activeDialogueId: 'd1',
    onOpenMemory: vi.fn(),
    responseLength: 'standard',
    reasoning: false,
    onSetResponseLength: vi.fn(),
    onToggleReasoning: vi.fn(),
    onExport: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    selectedPersonaId: 'gp',
    setSelectedPersonaId: vi.fn(),
    allPersonas: [{ id: 'gp', name: PERSONA, emoji: '🙂', isPreset: true }],
    openPersonaDetail: vi.fn(),
    onCreatePersona: vi.fn(),
    onOpenDialogues: vi.fn(),
    onNewDialogue: vi.fn(),
    quota: { chatRemaining: 59, chatTotal: 60, reasoningRemaining: 5, reasoningTotal: 5 },
    ...extra,
  } as unknown as AIChatHeaderProps;
}

/** Строки шапки на телефоне: ☰, «⋯», «+». */
const HEADER_ICONS = ['ai_dialogues_open', 'ai_more', 'ai_new_dialogue'];

/** Порядок пунктов листа «⋯» менять нельзя (MF-12) — проверяем его целиком. */
const MORE_SHEET_ROWS = ['ai_memory_title', 'ai_dialogue_rename', 'ai_download_md', 'ai_to_archive', 'ai_delete'];

function renderMoreSheet(): { props: AIChatHeaderProps; dialog: HTMLElement } {
  const props = headerProps(true);
  render(<AIChatHeader {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'ai_more' }));
  return { props, dialog: screen.getByRole('dialog') };
}

function dialogue(id: string, title: string, updatedAt: number, extra: Partial<AIDialogue> = {}): AIDialogue {
  return {
    id,
    title,
    personaId: 'gp',
    personaName: PERSONA,
    personaEmoji: '🙂',
    messages: [{ role: 'user', content: `Текст первой реплики про ${title}` }],
    createdAt: updatedAt - DAY,
    updatedAt,
    ...extra,
  } as AIDialogue;
}

function listSheetProps(overrides: Partial<Parameters<typeof MobileDialogueListSheet>[0]> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    dialogues: [dialogue('d1', 'Про гончарный круг', Date.now())],
    archivedDialogues: [dialogue('d2', 'Старый диалог', Date.now() - 40 * DAY, { archivedAt: Date.now() - 40 * DAY })],
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
}

/** Долгое нажатие (правый клик) открывает лист действий поверх списка диалогов. */
function openDialogueActions(props = listSheetProps()): HTMLElement {
  render(<MobileDialogueListSheet {...props} />);
  fireEvent.contextMenu(screen.getByRole('button', { name: /Про гончарный круг/ }));
  const dialogs = screen.getAllByRole('dialog');
  const actions = dialogs[dialogs.length - 1]!;
  expect(within(actions).getByRole('button', { name: /ai_to_archive/ })).toBeTruthy();
  return actions;
}

function personaSheetProps(overrides: Partial<MobilePersonaSheetProps> = {}): MobilePersonaSheetProps {
  return {
    open: true,
    onClose: vi.fn(),
    // Id пресетов берутся из `personaVisuals`: у пресета есть свой вензель
    // («Гп», «К»), у выдуманного id — первая буква имени.
    personas: [
      { id: 'group_psychology', name: PERSONA, emoji: '🙂', isPreset: true },
      { id: 'cbt', name: 'КПТ-консультант', emoji: '🧠', isPreset: true },
    ],
    selectedPersonaId: 'group_psychology',
    onSelect: vi.fn(),
    onDetail: vi.fn(),
    onCreate: vi.fn(),
    ...overrides,
  };
}

describe('U-26.1: имя ассистента над ответом', () => {
  afterEach(() => cleanup());

  it('на телефоне имя — тем же классом, что на десктопе (чернила, без brand-soft)', () => {
    const phone = render(<AssistantTurn name={PERSONA} color="#A583E8" mono="Гп" isMobile>{ANSWER}</AssistantTurn>);
    const desk = render(<AssistantTurn name={PERSONA} color="#A583E8" mono="Гп">{ANSWER}</AssistantTurn>);
    const phoneName = within(phone.container).getByText(PERSONA);
    const deskName = within(desk.container).getByText(PERSONA);
    expect(deskName.className).toContain('text-text-main');
    expect(phoneName.className, 'имя ассистента на телефоне не чернилом').toBe(deskName.className);
    expect(phoneName.className).not.toContain('text-brand-soft');
  });

  it('десктоп не изменился: у имени по-прежнему Monogram 36 рядом', () => {
    const { container } = render(<AssistantTurn name={PERSONA} color="#A583E8" mono="Гп">{ANSWER}</AssistantTurn>);
    expect(within(container).getByText(PERSONA).className).toContain('text-text-main');
    expect(monogramIn(container, 36), 'на десктопе Monogram у имени пропал').toBeTruthy();
    // На телефоне колонки аватара нет (MC-5) — имя остаётся одной строкой.
    cleanup();
    const phone = render(<AssistantTurn name={PERSONA} color="#A583E8" mono="Гп" isMobile>{ANSWER}</AssistantTurn>);
    expect(monogramIn(phone.container, 36)).toBeUndefined();
  });
});

describe('U-26.2: единый вид значков шапки на телефоне', () => {
  afterEach(() => cleanup());

  it('☰, «⋯» и «+» — один и тот же общий IconButton: без рамки, цель 44 px', () => {
    render(<AIChatHeader {...headerProps(true)} />);
    const icons = HEADER_ICONS.map(name => screen.getByRole('button', { name }));
    for (const icon of icons) {
      expect(icon.className, `у значка ${icon.getAttribute('aria-label')} осталась рамка`).not.toMatch(/border/);
      expect(icon.className, `у значка ${icon.getAttribute('aria-label')} цель не 44 px`).toContain('w-11');
      expect(icon.className).toContain('h-11');
    }
    // «Единый вид» — не три набора классов, а один.
    expect(new Set(icons.map(i => i.className)).size, 'значки шапки различаются классами').toBe(1);
  });

  it('десктопная шапка осталась как была: своего ☰ нет, у рядовых значков рамка', () => {
    render(<AIChatHeader {...headerProps(false)} />);
    expect(screen.queryByRole('button', { name: 'ai_dialogues_open' })).toBeNull();
    expect(screen.getByRole('button', { name: 'ai_memory_title' }).className).toContain('border-border-subtle');
  });
});

describe('U-26.3: лист действий диалога — общая строка листа (U-22)', () => {
  afterEach(() => cleanup());

  it('каждая строка — `SHEET_ROW`, рамки под строками сняты', () => {
    const { dialog } = renderMoreSheet();
    for (const name of MORE_SHEET_ROWS) {
      const row = within(dialog).getByRole('button', { name });
      expect(row.className, `${name}: строка не на SHEET_ROW`).toContain('min-h-12');
      expect(row.className, `${name}: у строки осталась рамка`).not.toMatch(/border/);
    }
    for (const name of MORE_SHEET_ROWS.slice(0, 4)) {
      expect(within(dialog).getByRole('button', { name }).className, `${name} не равна SHEET_ROW`).toBe(SHEET_ROW);
    }
    // Опасный пункт несёт общий стиль плюс цвет удаления.
    const del = within(dialog).getByRole('button', { name: 'ai_delete' });
    expect(del.className).toContain('text-accent-danger');
  });

  it('группы разделяет общий `SHEET_DIVIDER`, удаление отбито чертой', () => {
    const { dialog } = renderMoreSheet();
    const separators = Array.from(dialog.querySelectorAll('[role="separator"]'));
    expect(separators.length, 'в листе нет разделителей групп').toBeGreaterThanOrEqual(2);
    for (const sep of separators) expect(sep.className).toBe(SHEET_DIVIDER);
    const del = within(dialog).getByRole('button', { name: 'ai_delete' });
    expect(del.previousElementSibling?.getAttribute('role'), 'перед «Удалить» нет разделителя').toBe('separator');
    const rename = within(dialog).getByRole('button', { name: 'ai_dialogue_rename' });
    expect(rename.previousElementSibling?.getAttribute('role'), 'группа действий диалога не начата чертой').toBe('separator');
  });

  it('порядок пунктов листа не изменился', () => {
    const { dialog } = renderMoreSheet();
    const labels = Array.from(dialog.querySelectorAll('button'))
      .map(b => (b.textContent ?? '').trim())
      .filter(text => MORE_SHEET_ROWS.includes(text));
    expect(labels).toEqual(MORE_SHEET_ROWS);
  });

  it('значок строки листа — 18 px, как в листе действий заметки', () => {
    const { dialog } = renderMoreSheet();
    for (const name of ['ai_memory_title', 'ai_download_md', 'ai_delete']) {
      const row = within(dialog).getByRole('button', { name });
      expect(row.querySelector('svg')?.getAttribute('width'), `${name}: у значка строки не 18 px`).toBe('18');
    }
  });

  it('лист действий из ☰ — та же строка листа с подписью', () => {
    const props = listSheetProps();
    const actions = openDialogueActions(props);
    for (const name of ['ai_dialogue_rename', 'ai_to_archive']) {
      const row = within(actions).getByRole('button', { name });
      expect(row.className, `${name}: строка не на SHEET_ROW`).toBe(SHEET_ROW);
      expect(row.textContent, `${name}: у строки нет подписи`).toContain(name);
      expect(row.querySelector('svg')?.getAttribute('width'), `${name}: значок строки не 18 px`).toBe('18');
    }
    const del = within(actions).getByRole('button', { name: /ai_delete/ });
    expect(del.className, '«Удалить» не на общем стиле строки').toContain('min-h-12');
    expect(del.className).toContain('text-accent-danger');
    expect(del.className).not.toMatch(/border/);
    expect(del.previousElementSibling?.getAttribute('role'), 'перед «Удалить» нет разделителя').toBe('separator');
  });
});

describe('U-26.4: выбор собеседника — значок вместо точки', () => {
  afterEach(() => cleanup());

  it('в строке собеседника — Monogram 18 px, как в десктопной строке', () => {
    render(<MobilePersonaSheet {...personaSheetProps()} />);
    const rows = screen.getAllByTestId('persona-row');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(monogramIn(row, 18), 'в строке нет Monogram 18 px').toBeTruthy();
      expect(row.innerHTML, 'точка 9 px осталась').not.toMatch(/width:\s*9px/);
      expect(row.className).toContain('h-12');
    }
    expect(rows[0]?.textContent).toContain('Гп');
    expect(rows[1]?.textContent).toContain('К');
    // Роль второй строкой остаётся (MP-3).
    expect(rows[0]?.textContent).toContain('многогранная перспектива');
  });

  it('у «Создать» — значок Plus, а не пустая строка', () => {
    render(<MobilePersonaSheet {...personaSheetProps()} />);
    const create = screen.getByRole('button', { name: /ai_persona_create_row/ });
    const svg = create.querySelector('svg');
    expect(svg, 'у строки «Создать» нет значка').toBeTruthy();
    expect(svg?.getAttribute('width')).toBe('18');
    expect(monogramIn(create, 18), 'у «Создать» нарисован Monogram вместо Plus').toBeUndefined();
  });

  it('десктопная строка выбора собеседника — тот же Monogram 18 px (эталон)', () => {
    const { container } = render(<AIChatHeader {...headerProps(false)} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(PERSONA) }));
    expect(monogramIn(container, 18), 'в десктопном списке нет Monogram 18 px').toBeTruthy();
  });
});

describe('U-26.5: подтверждение переименования — общий primary без text-white', () => {
  afterEach(() => cleanup());

  // `text-white` на светлых темах невидим — правка только телефонная, десктоп
  // свою строку переименования не трогает.
  const PRIMARY = 'bg-text-main text-surface-base';

  it('в листе «⋯» кнопка подтверждения — `Button variant="primary"` и она работает', () => {
    const { props, dialog } = renderMoreSheet();
    fireEvent.click(within(dialog).getByRole('button', { name: 'ai_dialogue_rename' }));
    const field = screen.getByRole('textbox', { name: 'ai_dialogue_rename' });
    fireEvent.change(field, { target: { value: 'Новое имя' } });
    const confirm = screen.getByRole('button', { name: 'ai_dialogue_rename' });
    expect(confirm.className, 'кнопка не на общем primary').toContain(PRIMARY);
    expect(confirm.className).not.toMatch(/text-white|bg-accent\b/);
    fireEvent.click(confirm);
    expect(props.onRename).toHaveBeenCalledWith('d1', 'Новое имя');
  });

  it('в листе диалогов кнопка подтверждения — тот же общий primary', () => {
    const props = listSheetProps();
    const actions = openDialogueActions(props);
    fireEvent.click(within(actions).getByRole('button', { name: /ai_dialogue_rename/ }));
    const last = screen.getAllByRole('dialog').slice(-1)[0]!;
    const confirm = within(last).getByRole('button', { name: /ai_dialogue_rename/ });
    expect(confirm.className, 'кнопка не на общем primary').toContain(PRIMARY);
    expect(confirm.className).not.toMatch(/text-white|bg-accent\b/);
    fireEvent.change(within(last).getByRole('textbox', { name: /ai_dialogue_rename/ }), { target: { value: 'Имя' } });
    fireEvent.click(within(last).getByRole('button', { name: /ai_dialogue_rename/ }));
    expect(props.onRename).toHaveBeenCalledWith('d1', 'Имя');
  });
});
