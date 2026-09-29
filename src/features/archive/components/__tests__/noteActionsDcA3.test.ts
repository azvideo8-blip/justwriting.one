import { describe, it, expect, vi } from 'vitest';
import { buildNoteActions, sectionsToMenuEntries, NoteMenuSection } from '../noteActions';
import { NoteStorageActions } from '../useNoteStorageActions';

const t = (k: string) => k;

const storage = (): NoteStorageActions => ({
  uploading: false,
  downloading: false,
  requestLocal: vi.fn(),
  requestCloud: vi.fn(),
  requestExclusion: vi.fn(),
  confirm: null,
  handleConfirm: vi.fn(),
  cancelConfirm: vi.fn(),
  dialogs: null,
});

const base = {
  t,
  userId: 'user_1',
  labels: undefined as undefined | { id: string; name: string; color: string }[],
  currentLabelId: undefined as string | undefined,
  onLabelChange: undefined as ((id: string | undefined) => void) | undefined,
  onOpen: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
};

const ids = (sections: NoteMenuSection[]) =>
  sections.filter(s => s.kind === 'action').map(s => s.id as string);

describe('DC-A3 buildNoteActions: один список для меню и листа действий', () => {
  it('порядок: открыть, переименовать, хранение, удалить — удаление последнее и опасное', () => {
    const sections = buildNoteActions({
      ...base,
      doc: { localId: 'l1', cloudId: 'c1', hasLocal: true, hasCloud: true },
      storage: storage(),
    });
    expect(ids(sections)).toEqual(['open', 'rename', 'removeLocal', 'removeCloud', 'delete']);
    const actions = sections.filter((s): s is Extract<NoteMenuSection, { kind: 'action' }> => s.kind === 'action');
    expect(actions[actions.length - 1]?.destructive).toBe(true);
  });

  it('облачная заметка без локальной копии: есть скачивание, нет загрузки', () => {
    const sections = buildNoteActions({
      ...base,
      doc: { cloudId: 'c1', hasLocal: false, hasCloud: true },
      storage: storage(),
    });
    expect(ids(sections)).toEqual(['open', 'rename', 'download', 'removeCloud', 'delete']);
  });

  it('локальная заметка: есть загрузка, нет скачивания и удаления копий', () => {
    const sections = buildNoteActions({
      ...base,
      doc: { localId: 'l1', hasLocal: true, hasCloud: false },
      storage: storage(),
    });
    expect(ids(sections)).toEqual(['open', 'rename', 'upload', 'delete']);
    const upload = sections.find(s => s.kind === 'action' && s.id === 'upload');
    expect(upload && upload.kind === 'action' && upload.label).toBe('storage_upload_to_cloud');
  });

  it('неотправленные изменения: пункт называется «отправить», удаление облачной копии недоступно', () => {
    const sections = buildNoteActions({
      ...base,
      doc: { localId: 'l1', cloudId: 'c1', hasLocal: true, hasCloud: true, hasPendingSync: true },
      storage: storage(),
    });
    const upload = sections.find(s => s.kind === 'action' && s.id === 'upload');
    expect(upload && upload.kind === 'action' && upload.label).toBe('storage_sync_now');
    expect(ids(sections)).not.toContain('removeCloud');
  });

  it('слишком большая заметка: загрузки в облако нет', () => {
    const sections = buildNoteActions({
      ...base,
      doc: { localId: 'l1', hasLocal: true, hasCloud: false, isTooLargeForSync: true },
      storage: storage(),
    });
    expect(ids(sections)).not.toContain('upload');
  });

  it('гость: загрузки в облако нет', () => {
    const sections = buildNoteActions({
      ...base,
      userId: 'guest_1',
      doc: { localId: 'l1', hasLocal: true, hasCloud: false },
      storage: storage(),
    });
    expect(ids(sections)).not.toContain('upload');
  });

  it('метки идут после переименования, «Без метки» — только когда метка назначена', () => {
    const labels = [{ id: 'a', name: 'Работа', color: '#f00' }];
    const withLabel = buildNoteActions({
      ...base,
      labels,
      currentLabelId: 'a',
      onLabelChange: vi.fn(),
      doc: { localId: 'l1', hasLocal: true, hasCloud: false },
      storage: storage(),
    });
    const section = withLabel.find(s => s.kind === 'labels');
    expect(section && section.kind === 'labels' && section.options.map(o => o.key)).toEqual(['none', 'a']);
    const renameIdx = withLabel.findIndex(s => s.kind === 'action' && s.id === 'rename');
    const labelsIdx = withLabel.findIndex(s => s.kind === 'labels');
    const uploadIdx = withLabel.findIndex(s => s.kind === 'action' && s.id === 'upload');
    expect(labelsIdx).toBeGreaterThan(renameIdx);
    expect(labelsIdx).toBeLessThan(uploadIdx);

    const withoutLabel = buildNoteActions({
      ...base,
      labels,
      onLabelChange: vi.fn(),
      doc: { localId: 'l1', hasLocal: true, hasCloud: false },
      storage: storage(),
    });
    const opts = withoutLabel.find(s => s.kind === 'labels');
    expect(opts && opts.kind === 'labels' && opts.options.map(o => o.key)).toEqual(['a']);
  });

  it('пункт «Добавить тег» только когда передан обработчик', () => {
    const doc = { localId: 'l1', hasLocal: true, hasCloud: false };
    expect(ids(buildNoteActions({ ...base, doc, storage: storage() }))).not.toContain('addTag');
    expect(ids(buildNoteActions({ ...base, doc, storage: storage(), onAddTag: vi.fn() }))).toContain('addTag');
  });

  it('ИИ: разбор отключён, пока заметка скрыта; подпись переключается', () => {
    const doc = { localId: 'l1', hasLocal: true, hasCloud: false };
    const excluded = buildNoteActions({
      ...base,
      doc,
      storage: storage(),
      ai: { processed: false, loading: false, onClick: vi.fn() },
      exclusion: { excluded: true, loading: false, onClick: vi.fn() },
    });
    const analyze = excluded.find(s => s.kind === 'action' && s.id === 'analyzeAi');
    expect(analyze && analyze.kind === 'action' && analyze.disabled).toBe(true);
    expect(analyze && analyze.kind === 'action' && analyze.label).toBe('ai_note_excluded');
    const excludeItem = excluded.find(s => s.kind === 'action' && s.id === 'excludeAi');
    expect(excludeItem && excludeItem.kind === 'action' && excludeItem.label).toBe('ai_note_include');

    const visible = buildNoteActions({
      ...base,
      doc,
      storage: storage(),
      exclusion: { excluded: false, loading: false, onClick: vi.fn() },
    });
    const item = visible.find(s => s.kind === 'action' && s.id === 'excludeAi');
    expect(item && item.kind === 'action' && item.label).toBe('ai_note_exclude');
  });

  it('обработчики те же, что у строки: выбрать пункт — значит вызвать то, что вызывала кнопка', () => {
    const onOpen = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const st = storage();
    const labelChange = vi.fn();
    const sections = buildNoteActions({
      ...base,
      onOpen,
      onRename,
      onDelete,
      labels: [{ id: 'a', name: 'Работа', color: '#f00' }],
      currentLabelId: undefined,
      onLabelChange: labelChange,
      doc: { localId: 'l1', cloudId: 'c1', hasLocal: true, hasCloud: true },
      storage: st,
    });
    const pick = (id: string) => sections.find(s => s.kind === 'action' && s.id === id);
    (pick('open') as Extract<NoteMenuSection, { kind: 'action' }>).onSelect();
    (pick('rename') as Extract<NoteMenuSection, { kind: 'action' }>).onSelect();
    (pick('removeLocal') as Extract<NoteMenuSection, { kind: 'action' }>).onSelect();
    (pick('removeCloud') as Extract<NoteMenuSection, { kind: 'action' }>).onSelect();
    (pick('delete') as Extract<NoteMenuSection, { kind: 'action' }>).onSelect();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(st.requestLocal).toHaveBeenCalledTimes(1);
    expect(st.requestCloud).toHaveBeenCalledTimes(1);

    const labelsSection = sections.find(s => s.kind === 'labels');
    expect(labelsSection && labelsSection.kind === 'labels');
    if (labelsSection && labelsSection.kind === 'labels') {
      labelsSection.options[0]?.onSelect();
      expect(labelChange).toHaveBeenCalledWith('a');
    }
  });
});

describe('DC-A3 sectionsToMenuEntries', () => {
  it('между группами стоит разделитель, метки — menuitemradio с заголовком', () => {
    const sections = buildNoteActions({
      ...base,
      labels: [{ id: 'a', name: 'Работа', color: '#f00' }],
      currentLabelId: 'a',
      onLabelChange: vi.fn(),
      doc: { localId: 'l1', hasLocal: true, hasCloud: false },
      storage: storage(),
    });
    const kinds = sectionsToMenuEntries(sections).map(e => e.kind);
    expect(kinds.slice(0, 6)).toEqual(['item', 'item', 'separator', 'heading', 'radio', 'radio']);
    expect(kinds[kinds.length - 1]).toBe('item');
    expect(kinds.filter(k => k === 'separator').length).toBe(3);
  });
});
