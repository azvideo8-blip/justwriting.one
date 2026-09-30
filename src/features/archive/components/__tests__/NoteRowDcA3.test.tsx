import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import { getSessionKey } from '../../../../core/crypto/encrypt';
import { NoteRow } from '../NoteRow';
import { ArchiveSession } from '../../types';
import { Label } from '../../../../types';

vi.mock('../../../../core/crypto/encrypt', async (importActual) => {
  const actual = await importActual<typeof import('../../../../core/crypto/encrypt')>();
  return { ...actual, getSessionKey: vi.fn() };
});

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ profile: null, user: null }),
}));

vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: {
    addLocalCopy: vi.fn(),
    addCloudCopy: vi.fn(),
    removeLocalCopy: vi.fn(),
    removeCloudCopy: vi.fn(),
    trashDocument: vi.fn(),
  },
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));

const t = (k: string) => k;

const labels: Label[] = [{ id: 'lbl_1', name: 'Работа', color: '#e0a458' }];

function sessionOf(extra: Partial<ArchiveSession> = {}): ArchiveSession {
  return {
    id: 'doc_1',
    userId: 'u1',
    content: 'Текст заметки для теста строки архива.',
    duration: 300,
    wordCount: 42,
    sessionWordsAdded: 42,
    sittings: [],
    charCount: 30,
    wpm: 8,
    title: 'Первая строка заголовка',
    tags: [],
    createdAt: new Date(2025, 8, 1, 9, 5),
    sessionStartTime: new Date(2025, 8, 1, 9, 5).getTime(),
    _isLocal: true,
    ...extra,
  };
}

function renderRow(session: ArchiveSession, handlers: Record<string, unknown> = {}) {
  return render(
    <NoteRow
      session={session}
      onOpen={vi.fn()}
      t={t}
      language="ru"
      userId="user_1"
      labels={labels}
      {...handlers}
    />,
  );
}

describe('DC-A3 строка архива (с поправками владельца 2026-09-30): заголовок первый, меню «⋯», полоса метки и цветные копии', () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(getSessionKey).mockReturnValue({ key: 'k' } as never);
  });

  it('одна кнопка «Действия с заметкой», инлайновых кнопок больше нет', () => {
    renderRow(sessionOf(), { onDelete: vi.fn() });

    expect(screen.getAllByRole('button', { name: 'archive_note_actions' })).toHaveLength(1);
    for (const gone of ['archive_preview', 'archive_rename_title', 'archive_delete', 'storage_upload_to_cloud', 'archive_assign_label']) {
      expect(screen.queryByRole('button', { name: gone })).not.toBeInTheDocument();
    }
  });

  it('дата — одна строка в sentence case, год только когда он не текущий', () => {
    renderRow(sessionOf({ _isLocal: false, _hasCloudCopy: true, _linkedCloudId: 'cloud_1' }));
    const dateLine = screen.getByText('1 сент. 2025, 09:05');
    expect(dateLine).toBeInTheDocument();
    expect(dateLine.className).not.toContain('font-mono');
    expect(dateLine.className).not.toContain('uppercase');
    expect(dateLine.textContent).not.toMatch(/[А-ЯЁ]/);
    // «только в облаке» — один раз, в плашке у заголовка, а не повтором под датой
    expect(screen.getAllByText('archive_cloud_only')).toHaveLength(1);
  });

  // 2026-09-30: владелец вернул полосу метки и цветные кнопки копий (отмена
  // части DC-A3): состояние заметки должно читаться с первого взгляда.
  it('метка — цветная полоса слева, без точки у заголовка', () => {
    const { container } = renderRow(sessionOf({ labelId: 'lbl_1' }));
    expect(screen.queryByRole('img', { name: 'Работа' })).not.toBeInTheDocument();

    const row = container.querySelector('div.grid') as HTMLElement;
    expect(row.className).toContain('border-l-2');
    expect(row.style.borderLeftColor).not.toBe('');
  });

  it('копии — цветные кнопки: есть копия — фиолетовая, нет — приглушена', () => {
    renderRow(sessionOf({ _hasCloudCopy: true, _linkedCloudId: 'cloud_1' }));
    const local = screen.getByRole('button', { name: 'archive_status_local · storage_remove_local' });
    const cloud = screen.getByRole('button', { name: 'archive_status_cloud · storage_remove_cloud' });
    expect(local.classList.contains('text-brand-soft')).toBe(true);
    expect(cloud.classList.contains('text-brand-soft')).toBe(true);
    cleanup();

    renderRow(sessionOf({ _isLocal: true, _hasCloudCopy: false }));
    const upload = screen.getByRole('button', { name: 'archive_status_no_cloud · storage_upload_to_cloud' });
    expect(upload.classList.contains('text-brand-soft')).toBe(false);
  });

  it('нажал на облако — ушло в облако: тот же запрос, что у пункта меню', async () => {
    const { StorageService } = await import('../../../../core/services/StorageService');
    vi.mocked(StorageService.addCloudCopy).mockResolvedValueOnce('cloud_new' as never);
    renderRow(sessionOf({ _isLocal: true, _hasCloudCopy: false }));
    fireEvent.click(screen.getByRole('button', { name: 'archive_status_no_cloud · storage_upload_to_cloud' }));
    await waitFor(() => expect(StorageService.addCloudCopy).toHaveBeenCalledWith('user_1', 'doc_1'));
  });

  it('клик по «⋯» открывает меню; пункт удаляет заметку тем же обработчиком', () => {
    const onDelete = vi.fn();
    const onOpen = vi.fn();
    renderRow(sessionOf(), { onDelete, onOpen });

    fireEvent.click(screen.getByRole('button', { name: 'archive_note_actions' }));
    const menu = screen.getByRole('menu', { name: 'archive_note_actions' });
    expect(within(menu).getByRole('menuitem', { name: 'archive_preview' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'archive_rename_title' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'archive_delete' })).toBeInTheDocument();

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'archive_delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('правый клик по строке открывает то же меню', () => {
    renderRow(sessionOf(), { onDelete: vi.fn() });
    const row = screen.getByRole('button', { name: 'archive_note_actions' }).closest('div.grid') as HTMLElement;

    fireEvent.contextMenu(row, { clientX: 120, clientY: 240 });
    expect(screen.getByRole('menu', { name: 'archive_note_actions' })).toBeInTheDocument();
  });

  it('метки в меню — список radio, «Без метки» появляется только у помеченной заметки', () => {
    renderRow(sessionOf({ labelId: 'lbl_1' }), { onLabelChange: vi.fn(), onDelete: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'archive_note_actions' }));
    const menu = screen.getByRole('menu', { name: 'archive_note_actions' });
    // Метки — строкой кружков: имя у каждого в aria-label, а не в тексте.
    const radios = within(menu).getAllByRole('menuitemradio');
    expect(radios.map(r => r.getAttribute('aria-label'))).toEqual(['archive_no_label', 'Работа']);
    expect(within(menu).getByText('archive_assign_label')).toBeInTheDocument();

    cleanup();
    renderRow(sessionOf(), { onLabelChange: vi.fn(), onDelete: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'archive_note_actions' }));
    const plain = screen.getByRole('menu', { name: 'archive_note_actions' });
    expect(within(plain).getAllByRole('menuitemradio').map(r => r.getAttribute('aria-label'))).toEqual(['Работа']);
  });

  it('недоступные действия хранения отсутствуют: у облачной заметки нет загрузки, у локальной — скачивания', () => {
    cleanup();
    renderRow(sessionOf({ _isLocal: false, _hasCloudCopy: true, _linkedCloudId: 'cloud_1' }));
    fireEvent.click(screen.getByRole('button', { name: 'archive_note_actions' }));
    const cloudMenu = screen.getByRole('menu', { name: 'archive_note_actions' });
    expect(within(cloudMenu).queryByRole('menuitem', { name: 'storage_upload_to_cloud' })).not.toBeInTheDocument();
    expect(within(cloudMenu).getByRole('menuitem', { name: 'storage_download_to_local' })).toBeInTheDocument();
    cleanup();

    renderRow(sessionOf({ _isLocal: true, _hasCloudCopy: false }));
    fireEvent.click(screen.getByRole('button', { name: 'archive_note_actions' }));
    const localMenu = screen.getByRole('menu', { name: 'archive_note_actions' });
    expect(within(localMenu).queryByRole('menuitem', { name: 'storage_download_to_local' })).not.toBeInTheDocument();
    expect(within(localMenu).getByRole('menuitem', { name: 'storage_upload_to_cloud' })).toBeInTheDocument();
  });

  it('пункт «Загрузить на облако» ведёт в тот же код, что и прежняя пиктограмма: без модалки, сразу запрос', async () => {
    const { StorageService } = await import('../../../../core/services/StorageService');
    vi.mocked(StorageService.addCloudCopy).mockResolvedValueOnce('cloud_new' as never);
    renderRow(sessionOf({ _isLocal: true, _hasCloudCopy: false }));
    fireEvent.click(screen.getByRole('button', { name: 'archive_note_actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'storage_upload_to_cloud' }));
    await waitFor(() => expect(StorageService.addCloudCopy).toHaveBeenCalledWith('user_1', 'doc_1'));
  });
});
