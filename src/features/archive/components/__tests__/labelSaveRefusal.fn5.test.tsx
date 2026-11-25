// FN-5 (дейлик 20.11, Н-5): отказ сохранения метки не закрывает форму «как будто сохранено»:
// форма открыта с введённым, тост ошибки. Хук useLabelEditor и читалка/превью заметки.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { createElement as h } from 'react';
import { screen, fireEvent, waitFor, cleanup, renderHook, act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../../../shared/components/Toast';
import { LanguageProvider } from '../../../../shared/i18n';
import { ArchiveLabelBar } from '../ArchiveLabelBar';
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

// LB-1 (N-1): второе нажатие, пока первое сохранение в пути, не уходит в облако
// второй записью — во всех трёх формах меток и в правке карандашом.
describe('LB-1: двойное нажатие «Сохранить» в формах меток', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); });
  const wrapper = ({ children }: { children: ReactNode }) => h(LanguageProvider, null, h(ToastProvider, null, children));
  function pendingSave() {
    let finish!: (ok: boolean) => void;
    const save = vi.fn(() => new Promise<boolean>(r => { finish = r; }));
    return { save, finish: (ok: boolean) => finish(ok) };
  }

  // Введённое, пока ответ в пути, иначе пропало бы вместе с закрытой формой.
  function expectLocked(input: HTMLElement, saveButton: HTMLElement) {
    expect((input as HTMLInputElement).readOnly).toBe(true);
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    const colors = Array.from(input.parentElement!.querySelectorAll('button')).filter(b => b.querySelector('span[style]') !== null || b.style.background !== '');
    expect(colors.length).toBeGreaterThan(3);
    expect(colors.every(b => b.disabled)).toBe(true);
  }

  it('панель меток: пока форма сохраняется, её поле, цвета и «Сохранить» закрыты для правки', () => {
    for (const form of ['new', 'edit'] as const) {
      cleanup();
      render(h(LanguageProvider, null, h(ArchiveLabelBar, {
        labels: [{ id: 'l1', name: 'Альфа', color: '#111111' }], selectedLabels: [], onToggleLabel: vi.fn(),
        addingLabel: form === 'new', setAddingLabel: vi.fn(), newLabelName: 'Бета', setNewLabelName: vi.fn(),
        newLabelColor: '#111111', setNewLabelColor: vi.fn(), onAddLabel: vi.fn(),
        editingLabelId: form === 'edit' ? 'l1' : null, setEditingLabelId: vi.fn(), editLabelName: 'Бета', setEditLabelName: vi.fn(),
        editLabelColor: '#111111', setEditLabelColor: vi.fn(), onUpdateLabel: vi.fn(), onDeleteLabel: vi.fn(),
        savingNewLabel: form === 'new', savingEditedLabel: form === 'edit', showControls: true,
      })));
      expectLocked(screen.getByDisplayValue('Бета'), button(document.body, 'Сохранить', true));
    }
  });

  it('панель меток: пока сохраняется одна метка, правка другой уходит и её форма не закрывается чужим ответом', async () => {
    const pending = new Map<string, (ok: boolean) => void>();
    const updateLabel = vi.fn((id: string) => new Promise<boolean>(r => { pending.set(id, r); }));
    const { result } = renderHook(
      () => useLabelEditor({ addLabel: vi.fn(async () => true), updateLabel, removeLabel: vi.fn(async () => true) }),
      { wrapper },
    );
    const edit = (id: string, name: string) => act(() => { result.current.setEditingLabelId(id); result.current.setEditLabelName(name); result.current.setEditLabelColor('#fff'); });
    edit('l1', 'Альфа2');
    act(() => { result.current.handleUpdateLabel('l1'); });
    expect(result.current.savingEditedLabel).toBe(true);
    edit('l2', 'Бета2');
    expect(result.current.savingEditedLabel).toBe(false);
    act(() => { result.current.handleUpdateLabel('l2'); });
    expect(updateLabel.mock.calls.map(c => c[0])).toEqual(['l1', 'l2']);
    await act(async () => { pending.get('l1')!(true); });
    expect(result.current.editingLabelId).toBe('l2');
    await act(async () => { pending.get('l2')!(true); });
    expect(result.current.editingLabelId).toBeNull();
    expect(result.current.savingEditedLabel).toBe(false);
  });

  it('панель меток: ответ за одну метку не забывает, с чем открыли другую — уходит только изменённое', async () => {
    const pending = new Map<string, (ok: boolean) => void>();
    const updateLabel = vi.fn((id: string, _updates: { name?: string; color?: string }) => new Promise<boolean>(r => { pending.set(id, r); }));
    const labels = [{ id: 'l1', name: 'Альфа', color: '#111111' }, { id: 'l2', name: 'Бета', color: '#222222' }];
    const { result } = renderHook(
      () => useLabelEditor({ addLabel: vi.fn(async () => true), updateLabel, removeLabel: vi.fn(async () => true), labels }),
      { wrapper },
    );
    const edit = (id: string, name: string, color: string) => act(() => { result.current.setEditingLabelId(id); result.current.setEditLabelName(name); result.current.setEditLabelColor(color); });
    edit('l1', 'Альфа2', '#111111');
    act(() => { result.current.handleUpdateLabel('l1'); });
    edit('l2', 'Бета2', '#222222');
    await act(async () => { pending.get('l1')!(true); });
    act(() => { result.current.handleUpdateLabel('l2'); });
    expect(updateLabel.mock.calls[1]).toEqual(['l2', { name: 'Бета2' }]);
    await act(async () => { pending.get('l2')!(true); });
  });

  it('панель меток: метку удалили на другом устройстве во время правки — «Добавить метку» на месте', () => {
    const bar = (editingLabelId: string) => h(LanguageProvider, null, h(ArchiveLabelBar, {
      labels: [{ id: 'l2', name: 'Бета', color: '#111111' }], selectedLabels: [], onToggleLabel: vi.fn(),
      addingLabel: false, setAddingLabel: vi.fn(), newLabelName: '', setNewLabelName: vi.fn(),
      newLabelColor: '#111111', setNewLabelColor: vi.fn(), onAddLabel: vi.fn(),
      editingLabelId, setEditingLabelId: vi.fn(), editLabelName: 'Альфа2', setEditLabelName: vi.fn(),
      editLabelColor: '#111111', setEditLabelColor: vi.fn(), onUpdateLabel: vi.fn(), onDeleteLabel: vi.fn(), showControls: true,
    }));
    const { rerender } = render(bar('gone'));
    expect(screen.queryByText(/Добавить метку/)).not.toBeNull();
    rerender(bar('l2'));
    expect(screen.queryByText(/Добавить метку/)).toBeNull();
  });

  it('панель меток: сохранение новой метки в пути видно форме', async () => {
    const { save, finish } = pendingSave();
    const { result } = renderHook(
      () => useLabelEditor({ addLabel: save, updateLabel: vi.fn(async () => true), removeLabel: vi.fn(async () => true) }),
      { wrapper },
    );
    act(() => { result.current.setAddingLabel(true); result.current.setNewLabelName('Бета'); });
    act(() => { result.current.handleAddLabel(); });
    expect(result.current.savingNewLabel).toBe(true);
    await act(async () => { finish(true); });
    expect(result.current.savingNewLabel).toBe(false);
  });

  it('читалка (телефон): два нажатия — один вызов сохранения; после ответа форма закрыта', async () => {
    layoutMode = 'mobile';
    const { save, finish } = pendingSave();
    renderPreview(save);
    fireEvent.click(screen.getByRole('button', { name: 'Инфо' }));
    const info = await screen.findByRole('dialog', { name: 'Инфо' });
    fireEvent.click(button(info, 'Добавить метку'));
    fireEvent.change(screen.getByPlaceholderText('Название...'), { target: { value: 'Мастерская' } });
    fireEvent.click(button(info, 'Сохранить', true));
    fireEvent.click(button(info, 'Сохранить', true));
    fireEvent.keyDown(screen.getByPlaceholderText('Название...'), { key: 'Enter' });
    expect(save).toHaveBeenCalledTimes(1);
    expectLocked(screen.getByPlaceholderText('Название...'), button(info, 'Сохранить', true));
    await act(async () => { finish(true); });
    await waitFor(() => expect(screen.queryByPlaceholderText('Название...')).toBeNull());
  });

  it('превью заметки (десктоп): два нажатия — один вызов сохранения; после отказа можно повторить', async () => {
    layoutMode = 'desktop';
    const { save, finish } = pendingSave();
    const { container } = renderPreview(save);
    fireEvent.click(button(container, 'Назначить метку'));
    fireEvent.click(button(container, 'Добавить метку'));
    const input = screen.getByPlaceholderText('Название...');
    fireEvent.change(input, { target: { value: 'Мастерская' } });
    fireEvent.click(button(container, 'Сохранить', true));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(save).toHaveBeenCalledTimes(1);
    expectLocked(input, button(container, 'Сохранить', true));
    await act(async () => { finish(false); });
    await waitFor(() => expect(screen.getByText(SAVE_FAILED)).toBeTruthy());
    expect((input as HTMLInputElement).readOnly).toBe(false);
    fireEvent.click(button(container, 'Сохранить', true));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('панель меток: новая метка и правка карандашом — по одному вызову на два нажатия', async () => {
    const add = pendingSave();
    const update = pendingSave();
    const { result } = renderHook(
      () => useLabelEditor({ addLabel: add.save, updateLabel: update.save, removeLabel: vi.fn(async () => true) }),
      { wrapper },
    );
    act(() => { result.current.setAddingLabel(true); result.current.setNewLabelName('Мастерская'); });
    act(() => { result.current.handleAddLabel(); result.current.handleAddLabel(); });
    expect(add.save).toHaveBeenCalledTimes(1);
    await act(async () => { add.finish(true); });
    act(() => { result.current.setEditingLabelId('l1'); result.current.setEditLabelName('Новое'); result.current.setEditLabelColor('#fff'); });
    act(() => { result.current.handleUpdateLabel('l1'); result.current.handleUpdateLabel('l1'); });
    expect(update.save).toHaveBeenCalledTimes(1);
    await act(async () => { update.finish(true); });
    expect(result.current.editingLabelId).toBeNull();
  });
});
