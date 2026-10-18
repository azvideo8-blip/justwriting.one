// B-6: выбор цвета метки получал aria-label литералом по-английски — «Select
// color #D04545» — и в RU, и в EN, мимо словаря. Подпись обязана приходить из
// ключа `archive_label_color_aria`: в RU — русская, в EN — английская, и в той
// и в другой называется сам цвет.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../../../shared/i18n';
import { archiveTranslations } from '../../../../shared/i18n/translations/archive';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { LABEL_PRESET_COLORS } from '../../../../core/constants/labelColors';
import { ToastProvider } from '../../../../shared/components/Toast';
import { ArchiveLabelBar } from '../ArchiveLabelBar';
import { DocumentPreview } from '../DocumentPreview';
import type { ArchiveSession } from '../../types';
import type { Label } from '../../../../types';

const COLOR_KEY = 'archive_label_color_aria';
const ENGLISH_LITERAL = 'Select color';
const LABELS: Label[] = [{ id: 'l1', name: 'Работа', color: LABEL_PRESET_COLORS[0] as string }];

/** Ожидаемая подпись — из словаря, а не из текста теста. */
function dictLabel(lang: 'ru' | 'en', color: string): string {
  const entry = archiveTranslations[COLOR_KEY];
  expect(entry, `ключа ${COLOR_KEY} в словаре нет`).toBeDefined();
  return (entry?.[lang] ?? '').replace('{color}', color);
}

/** Кнопки-кружки цвета: их подпись содержит сам hex-код. */
function colorButtons(): HTMLElement[] {
  return screen.getAllByRole('button').filter(btn =>
    LABEL_PRESET_COLORS.some(c => (btn.getAttribute('aria-label') ?? '').includes(c)),
  );
}

const ariaOf = (btn: HTMLElement | undefined) => btn?.getAttribute('aria-label') ?? '';

function renderLang(lang: 'ru' | 'en', ui: ReactNode) {
  localStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, lang);
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

function labelBarEdit(lang: 'ru' | 'en') {
  return renderLang(lang, (
    <ArchiveLabelBar
      labels={LABELS}
      selectedLabels={['l1']}
      onToggleLabel={vi.fn()}
      addingLabel={false}
      setAddingLabel={vi.fn()}
      newLabelName=""
      setNewLabelName={vi.fn()}
      newLabelColor={LABEL_PRESET_COLORS[0] as string}
      setNewLabelColor={vi.fn()}
      onAddLabel={vi.fn()}
      editingLabelId="l1"
      setEditingLabelId={vi.fn()}
      editLabelName="Работа"
      setEditLabelName={vi.fn()}
      editLabelColor={LABEL_PRESET_COLORS[2] as string}
      setEditLabelColor={vi.fn()}
      onUpdateLabel={vi.fn()}
      onDeleteLabel={vi.fn()}
      showControls
    />
  ));
}

function labelBarAdding(lang: 'ru' | 'en') {
  return renderLang(lang, (
    <ArchiveLabelBar
      labels={LABELS}
      selectedLabels={[]}
      onToggleLabel={vi.fn()}
      addingLabel
      setAddingLabel={vi.fn()}
      newLabelName="Новая"
      setNewLabelName={vi.fn()}
      newLabelColor={LABEL_PRESET_COLORS[1] as string}
      setNewLabelColor={vi.fn()}
      onAddLabel={vi.fn()}
      editingLabelId={null}
      setEditingLabelId={vi.fn()}
      editLabelName=""
      setEditLabelName={vi.fn()}
      editLabelColor={LABEL_PRESET_COLORS[0] as string}
      setEditLabelColor={vi.fn()}
      onUpdateLabel={vi.fn()}
      onDeleteLabel={vi.fn()}
      showControls
    />
  ));
}

const previewSession = {
  id: 'doc-b6',
  userId: 'u-b6',
  title: 'Про гончарный круг',
  content: 'Глина сохнет быстрее, чем кажется.',
  duration: 240,
  wordCount: 12,
  charCount: 68,
  wpm: 3,
  tags: [],
  createdAt: new Date(2026, 9, 14, 19, 5).getTime(),
  _isLocal: true,
} as unknown as ArchiveSession;

/** Цвета появляются в превью только в строке создания метки. */
function previewColorRow(lang: 'ru' | 'en') {
  renderLang(lang, (
    <MemoryRouter>
      <ToastProvider>
        <DocumentPreview
          session={previewSession}
          onClose={vi.fn()}
          onContinue={vi.fn()}
          labels={LABELS}
          onAddLabel={vi.fn()}
        />
      </ToastProvider>
    </MemoryRouter>
  ));
  fireEvent.click(screen.getByRole('button', { name: /Назначить метку|Assign label/ }));
  fireEvent.click(screen.getByRole('button', { name: /Добавить метку|Add label/ }));
}

describe('B-6: подпись выбора цвета метки — из словаря', () => {
  beforeEach(() => { cleanup(); localStorage.removeItem(STORAGE_KEYS.APP_LANGUAGE); });

  it('лист правки (RU): ни одной английской литеры, подпись = значение словаря', () => {
    labelBarEdit('ru');
    expect(archiveTranslations[COLOR_KEY]?.ru, 'RU-подпись не называет цвет').toContain('{color}');
    const picked = colorButtons();
    expect(picked.length, 'кружков цвета нет').toBe(LABEL_PRESET_COLORS.length);
    for (const btn of picked) {
      const name = btn.getAttribute('aria-label') ?? '';
      expect(name).not.toContain(ENGLISH_LITERAL);
      expect(name).toMatch(/[а-яё]/);
    }
    expect(picked[0]).toHaveAttribute('aria-label', dictLabel('ru', LABEL_PRESET_COLORS[0] as string));
    expect(ariaOf(picked[0])).toContain(LABEL_PRESET_COLORS[0]);
  });

  it('лист добавления (RU): те же подписи, что в словаре', () => {
    labelBarAdding('ru');
    const picked = colorButtons();
    expect(picked.length, 'кружков цвета нет').toBe(LABEL_PRESET_COLORS.length);
    expect(picked[1]).toHaveAttribute('aria-label', dictLabel('ru', LABEL_PRESET_COLORS[1] as string));
  });

  it('EN: подпись английская и всё равно из словаря, цвет назван', () => {
    labelBarEdit('en');
    const picked = colorButtons();
    expect(picked[0]).toHaveAttribute('aria-label', dictLabel('en', LABEL_PRESET_COLORS[0] as string));
    expect(ariaOf(picked[0])).toContain(LABEL_PRESET_COLORS[0]);
  });

  it('превью: строка создания метки больше не говорит по-английски в RU', () => {
    previewColorRow('ru');
    const picked = colorButtons();
    expect(picked.length, 'кружков цвета в превью нет').toBeGreaterThan(0);
    expect(picked.some(btn => (btn.getAttribute('aria-label') ?? '').includes(ENGLISH_LITERAL))).toBe(false);
    expect(picked[0]).toHaveAttribute('aria-label', dictLabel('ru', LABEL_PRESET_COLORS[0] as string));
  });

  // Приёмка 0.10.2 (сосед B-6): «Rename»/«Delete» у значков метки — из словаря.
  // Мутация: вернуть label="Rename" — красный.
  it('значки правки метки (RU) подписаны словарём, без «Rename»/«Delete»', () => {
    labelBarAdding('ru');
    const labels = screen.getAllByRole('button').map(ariaOf);
    expect(labels).toContain('Переименовать метку');
    expect(labels).toContain('Удалить метку');
    expect(labels.filter(l => /^(Rename|Delete)$/.test(l))).toEqual([]);
  });
});
