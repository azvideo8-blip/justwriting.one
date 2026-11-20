// FN-5 (дейлик 20.11, Н-5): отказ сохранения метки не закрывает форму «как будто сохранено»:
// форма открыта с введённым, тост ошибки. Хук useLabelEditor и читалка/превью заметки.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { createElement as h } from 'react';
import { screen, fireEvent, waitFor, cleanup, renderHook, act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../../../shared/components/Toast';
import { LanguageProvider } from '../../../../shared/i18n';
import { DocumentPreview } from '../DocumentPreview';
import { useLabelEditor } from '../../hooks/useLabelEditor';
import type { ArchiveSession } from '../../types';

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
vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));

const SAVE_FAILED = 'Метка не сохранилась. Попробуй ещё раз.';

describe('FN-5: useLabelEditor — отказ сохранения метки', () => {
  const wrapper = ({ children }: { children: ReactNode }) => h(LanguageProvider, null, h(ToastProvider, null, children));
  beforeEach(() => { cleanup(); vi.clearAllMocks(); });

  it('addLabel отказал — форма остаётся открытой с введённым, тост ошибки', async () => {
    const addLabel = vi.fn(async () => false);
    const { result } = renderHook(
      () => useLabelEditor({ addLabel, updateLabel: vi.fn(async () => true), removeLabel: vi.fn(async () => true) }),
      { wrapper },
    );
    act(() => { result.current.setAddingLabel(true); result.current.setNewLabelName('Мастерская'); });
    await act(async () => { result.current.handleAddLabel(); });
    expect(addLabel).toHaveBeenCalled();
    expect(result.current.addingLabel).toBe(true);
    expect(result.current.newLabelName).toBe('Мастерская');
    expect(screen.getByText(SAVE_FAILED)).toBeTruthy();
  });

  it('КОНТРОЛЬ: addLabel ответил — форма закрыта и очищена', async () => {
    const addLabel = vi.fn(async () => true);
    const { result } = renderHook(
      () => useLabelEditor({ addLabel, updateLabel: vi.fn(async () => true), removeLabel: vi.fn(async () => true) }),
      { wrapper },
    );
    act(() => { result.current.setAddingLabel(true); result.current.setNewLabelName('Мастерская'); });
    await act(async () => { result.current.handleAddLabel(); });
    expect(result.current.addingLabel).toBe(false);
    expect(result.current.newLabelName).toBe('');
  });

  it('updateLabel отказал — правка остаётся открытой', async () => {
    const updateLabel = vi.fn(async () => false);
    const { result } = renderHook(
      () => useLabelEditor({ addLabel: vi.fn(async () => true), updateLabel, removeLabel: vi.fn(async () => true) }),
      { wrapper },
    );
    act(() => { result.current.setEditingLabelId('l1'); result.current.setEditLabelName('Новое'); result.current.setEditLabelColor('#fff'); });
    await act(async () => { result.current.handleUpdateLabel('l1'); });
    expect(updateLabel).toHaveBeenCalled();
    expect(result.current.editingLabelId).toBe('l1');
  });
});

const session = {
  id: 'doc-fn5', userId: 'user-fn5', title: 'Синтетика', content: 'Текст синтетической записи для проверки.',
  duration: 60, wordCount: 5, charCount: 40, wpm: 5, tags: [], createdAt: new Date(2026, 10, 20, 9, 0).getTime(), _isLocal: true,
} as unknown as ArchiveSession;

type PreviewProps = ComponentProps<typeof DocumentPreview>;

function renderPreview(onAddLabel: PreviewProps['onAddLabel']) {
  const props: PreviewProps = {
    session, onClose: vi.fn(), onContinue: vi.fn(), onTagsChange: vi.fn(), onLabelChange: vi.fn(),
    onAddLabel, labels: [], allTags: [],
    onAnalyzeNote: vi.fn().mockResolvedValue({ ok: true }),
    fetchSummary: vi.fn().mockResolvedValue(null),
    fetchRelatedNotes: vi.fn().mockResolvedValue([]),
  };
  return render(h(LanguageProvider, null, h(MemoryRouter, null, h(ToastProvider, null, h(DocumentPreview, props)))));
}

function button(root: HTMLElement, text: string, exact = false): HTMLElement {
  const el = Array.from(root.querySelectorAll('button')).find(b => {
    const label = (b.textContent ?? '').trim().replace(/\s+/g, ' ');
    return exact ? label === text : label.includes(text);
  });
  if (!el) throw new Error(`нет кнопки «${text}»`);
  return el;
}

describe('FN-5: читалка заметки (телефон) — отказ создания метки', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); layoutMode = 'mobile'; });

  async function createLabelWith(onAddLabel: PreviewProps['onAddLabel']) {
    renderPreview(onAddLabel);
    fireEvent.click(screen.getByRole('button', { name: 'Инфо' }));
    const info = await screen.findByRole('dialog', { name: 'Инфо' });
    fireEvent.click(button(info, 'Добавить метку'));
    fireEvent.change(screen.getByPlaceholderText('Название...'), { target: { value: 'Мастерская' } });
    fireEvent.click(button(info, 'Сохранить', true));
    return info;
  }

  it('onAddLabel вернул false — форма открыта с введённым, тост ошибки', async () => {
    const onAddLabel = vi.fn(async () => false);
    await createLabelWith(onAddLabel);
    await waitFor(() => expect(screen.getByText(SAVE_FAILED)).toBeTruthy());
    expect((screen.getByPlaceholderText('Название...') as HTMLInputElement).value).toBe('Мастерская');
  });

  it('КОНТРОЛЬ: onAddLabel вернул true — форма закрыта, тоста нет', async () => {
    const onAddLabel = vi.fn(async () => true);
    await createLabelWith(onAddLabel);
    await waitFor(() => expect(screen.queryByPlaceholderText('Название...')).toBeNull());
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
  });
});
