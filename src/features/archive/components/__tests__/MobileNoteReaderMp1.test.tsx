// MP-1: на телефоне заметка открывается полноэкранной читалкой — заголовок и
// текст, а метаданные, теги, метка и разбор уезжают в «ⓘ». Десктопный
// `DocumentPreview` остаётся прежним.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { DocumentPreview } from '../DocumentPreview';
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

const session: ArchiveSession = {
  id: 'doc-mp1',
  userId: 'user-mp1',
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

const labels: Label[] = [{ id: 'label-work', name: 'Работа', color: '#7D4FD1' }];

type PreviewProps = ComponentProps<typeof DocumentPreview>;

function renderPreview(overrides: Partial<PreviewProps> = {}) {
  const props: PreviewProps = {
    session,
    onClose: vi.fn(),
    onContinue: vi.fn(),
    onTagsChange: vi.fn(),
    onLabelChange: vi.fn(),
    onAddLabel: vi.fn(),
    labels,
    allTags: ['глина', 'семья'],
    onAnalyzeNote: vi.fn().mockResolvedValue({ ok: true }),
    fetchSummary: vi.fn().mockResolvedValue(null),
    fetchRelatedNotes: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  return renderWithProviders(
    <MemoryRouter>
      <ToastProvider>
        <DocumentPreview {...props} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('MP-1: мобильная читалка заметки', () => {
  beforeEach(() => {
    cleanup();
    layoutMode = 'mobile';
  });

  it('в теле только заголовок и текст — без даты, тегов, метки и разбора', () => {
    renderPreview();
    expect(screen.getByText('Про гончарный круг')).toBeInTheDocument();
    expect(screen.getByText(/Глина сохнет быстрее/)).toBeInTheDocument();

    expect(screen.queryByText('Теги')).toBeNull();
    expect(screen.queryByText('Назначить метку')).toBeNull();
    expect(screen.queryByText('Проанализировать')).toBeNull();
    expect(screen.queryByText(/слов/)).toBeNull();
    expect(screen.queryByText('#глина')).toBeNull();
  });

  it('«‹ Заметки» закрывает читалку', () => {
    const onClose = vi.fn();
    renderPreview({ onClose });
    fireEvent.click(screen.getByRole('button', { name: /Заметки/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('«ⓘ» открывает окно, где живут дата, слова, метка и теги', async () => {
    renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Инфо' }));
    const dialog = await waitFor(() => {
      const el = screen.getByRole('dialog', { name: 'Инфо' });
      expect(el).toBeInTheDocument();
      return el;
    });
    expect(dialog.textContent).toContain('14 октября 2026');
    expect(dialog.textContent).toContain('12 слов');
    expect(dialog).toHaveTextContent('Теги');
    expect(dialog).toHaveTextContent('Работа');
    expect(dialog).toHaveTextContent('Проанализировать');
  });

  it('«⋯» открывает лист действий, а не читалку заново', async () => {
    renderPreview();
    const dialogsBefore = screen.getAllByRole('dialog').length;
    fireEvent.click(screen.getByRole('button', { name: 'Действия с заметкой' }));
    const sheet = await screen.findByRole('dialog', { name: 'Действия с заметкой' });
    expect(sheet).toBeInTheDocument();
    expect(screen.getAllByRole('dialog').length).toBe(dialogsBefore + 1);
    expect(screen.getByText(/Глина сохнет быстрее/)).toBeInTheDocument();
  });

  it('в листе «⋯» есть «Изменить», копия, «Не показывать ИИ» и удаление — и нет облачных пунктов', async () => {
    renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Действия с заметкой' }));
    const sheet = await screen.findByRole('dialog', { name: 'Действия с заметкой' });
    expect(within(sheet, 'Изменить', true)).toBeTruthy();
    expect(within(sheet, 'Изменить название')).toBeTruthy();
    expect(within(sheet, 'Скопировать как')).toBeTruthy();
    expect(within(sheet, 'Не показывать ИИ')).toBeTruthy();
    expect(within(sheet, 'Удалить заметку')).toBeTruthy();
    expect(sheet.textContent).not.toMatch(/Загрузить на облако|Скачать на это устройство|Удалить локальную копию|Удалить облачную копию|Отправить изменения/);
    expect(sheet.textContent).not.toContain('Назначить метку');
  });

  it('«Изменить» в листе ведёт в редактор этой же заметки', async () => {
    const onContinue = vi.fn();
    renderPreview({ onContinue });
    fireEvent.click(screen.getByRole('button', { name: 'Действия с заметкой' }));
    const sheet = await screen.findByRole('dialog', { name: 'Действия с заметкой' });
    fireEvent.click(within(sheet, 'Изменить', true));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('разбор запускается только по нажатию в «ⓘ»', async () => {
    const onAnalyzeNote = vi.fn().mockResolvedValue({ ok: true });
    renderPreview({ onAnalyzeNote });
    expect(onAnalyzeNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Инфо' }));
    const dialog = await screen.findByRole('dialog', { name: 'Инфо' });
    fireEvent.click(within(dialog, 'Проанализировать'));
    await waitFor(() => expect(onAnalyzeNote).toHaveBeenCalledWith('doc-mp1'));
  });

  it('десктопный предпросмотр остаётся прежним: дата, «Теги», метка и разбор на месте', () => {
    layoutMode = 'desktop';
    renderPreview();
    expect(screen.getByText(/Архив/)).toBeInTheDocument();
    expect(screen.getByText('Теги')).toBeInTheDocument();
    expect(screen.getByText('Работа')).toBeInTheDocument();
    expect(screen.getByText('Проанализировать')).toBeInTheDocument();
    expect(screen.getByText(/12 слов/)).toBeInTheDocument();
  });
});

// Ревью 0.9.40: три возможности, которые MP-1 оставил только десктопу.
// Мутации: «Изменить название» снова открывает редактор → красный первый кейс;
// убрать «+ Добавить метку» → красный второй; убрать блок связанных → красный третий.
describe('Ревью 0.9.40: читалка умеет то же, что десктопная панель', () => {
  beforeEach(() => {
    cleanup();
    layoutMode = 'mobile';
  });

  it('«Изменить название» переименовывает, а не открывает редактор', async () => {
    const onTitleChange = vi.fn();
    const onContinue = vi.fn();
    renderPreview({ onTitleChange, onContinue });
    fireEvent.click(screen.getByRole('button', { name: 'Действия с заметкой' }));
    const sheet = await screen.findByRole('dialog', { name: 'Действия с заметкой' });
    fireEvent.click(within(sheet, 'Изменить название'));
    const rename = await screen.findByRole('dialog', { name: 'Изменить название' });
    const input = rename.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'Новый круг' } });
    fireEvent.click(within(rename, 'Сохранить', true));
    expect(onTitleChange).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }), 'Новый круг');
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('в «ⓘ» можно создать новую метку', async () => {
    const onAddLabel = vi.fn();
    renderPreview({ onAddLabel });
    fireEvent.click(screen.getByRole('button', { name: 'Инфо' }));
    const info = await screen.findByRole('dialog', { name: 'Инфо' });
    fireEvent.click(within(info, 'Добавить метку'));
    fireEvent.change(screen.getByPlaceholderText('Название...'), { target: { value: 'Мастерская' } });
    fireEvent.click(within(info, 'Сохранить', true));
    expect(onAddLabel).toHaveBeenCalledWith({ name: 'Мастерская', color: expect.any(String) });
  });

  it('в конце текста — «Связанные записи»', async () => {
    renderPreview({
      // Связанные кэшируются по id на уровне модуля — свой id, чтобы не взять пустой кэш соседей.
      session: { ...session, id: 'doc_with_related' } as ArchiveSession,
      fetchRelatedNotes: vi.fn().mockResolvedValue([{ documentId: 'doc_rel_1', title: 'Обжиг в субботу', date: '2026-10-10', score: 0.8 }]),
    });
    expect(await screen.findByText('Связанные записи')).toBeInTheDocument();
    expect(screen.getByText('Обжиг в субботу')).toBeInTheDocument();
  });
});

function within(dialog: HTMLElement, text: string, exact = false): HTMLElement {
  const el = Array.from(dialog.querySelectorAll('button')).find(b => {
    const label = (b.textContent ?? '').trim().replace(/\s+/g, ' ');
    return exact ? label === text : label.includes(text);
  });
  if (!el) throw new Error(`в окне нет кнопки «${text}»`);
  return el;
}
