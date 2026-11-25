import { useRef, useState } from 'react';
import { LABEL_PRESET_COLORS } from '../../../core/constants/labelColors';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';

export function useLabelEditor({
  addLabel,
  updateLabel,
  removeLabel,
  labels,
}: {
  addLabel: (label: { name: string; color: string }) => Promise<boolean>;
  updateLabel: (id: string, updates: { name?: string; color?: string }) => Promise<boolean>;
  removeLabel: (id: string) => Promise<boolean>;
  /** Метки на экране: по ним запоминается, с чем открыли форму правки. */
  labels?: Array<{ id: string; name: string; color: string }>;
}) {
  const { t } = useLanguage();
  const { confirm } = useConfirmDialog();
  const { showToast } = useToast();
  const [addingLabel, setAddingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(LABEL_PRESET_COLORS[0] ?? '#7BA9F0');
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editLabelName, setEditLabelName] = useState('');
  const [editLabelColor, setEditLabelColor] = useState('');

  // LB-1: что человек изменил, решается по значениям на момент открытия формы, а не
  // по тому, что на экране к моменту сохранения: список за это время мог обновиться
  // (сейф открыли, пришло чтение), и «то же имя» означало бы уже другое.
  const openedRef = useRef<{ id: string; name: string; color: string } | null>(null);
  const openEditing = (id: string | null) => {
    const label = id ? labels?.find(l => l.id === id) : undefined;
    openedRef.current = label ? { id: label.id, name: label.name, color: label.color } : null;
    setEditingLabelId(id);
  };

  // Формы, чьё сохранение в пути: '' — новая метка, иначе id. Такая форма закрыта
  // для правки на экране (две правки одной метки легли бы в облако в любом порядке),
  // остальные — нет: запись под версией строки разводит их сама.
  const savingRef = useRef(new Set<string>());
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const once = async (form: string, save: () => Promise<void>) => {
    if (savingRef.current.has(form)) return;
    savingRef.current.add(form);
    setSaving(new Set(savingRef.current));
    try { await save(); } finally {
      savingRef.current.delete(form);
      setSaving(new Set(savingRef.current));
    }
  };

  const saveNewLabel = async () => {
    const trimmed = newLabelName.trim();
    if (trimmed) {
      // Отказ сохранения — форма остаётся открытой с введённым, тост ошибки.
      if (!(await addLabel({ name: trimmed, color: newLabelColor }))) {
        showToast(t('archive_label_save_failed'), 'error');
        return;
      }
      setNewLabelName('');
      setAddingLabel(false);
      setNewLabelColor(LABEL_PRESET_COLORS[0] ?? '#7BA9F0');
    }
  };

  const saveEditedLabel = async (id: string) => {
    const trimmed = editLabelName.trim();
    if (trimmed) {
      const opened = openedRef.current?.id === id ? openedRef.current : null;
      const updates: { name?: string; color?: string } = {};
      if (!opened || trimmed !== opened.name) updates.name = trimmed;
      if (!opened || editLabelColor !== opened.color) updates.color = editLabelColor;
      // «…» — заглушка нерасшифрованного имени; как имя она стёрла бы настоящее.
      if (updates.name === '…') {
        showToast(t('archive_label_save_failed'), 'error');
        return;
      }
      if ((updates.name !== undefined || updates.color !== undefined) && !(await updateLabel(id, updates))) {
        showToast(t('archive_label_save_failed'), 'error');
        return;
      }
    }
    // Закрываем свою форму: пока ответ шёл, могли открыть правку другой метки.
    if (openedRef.current?.id === id) openedRef.current = null;
    setEditingLabelId(current => (current === id ? null : current));
  };

  const handleAddLabel = () => { void once('', saveNewLabel); };
  const handleUpdateLabel = (id: string) => { void once(id, () => saveEditedLabel(id)); };

  const requestDeleteLabel = async (id: string) => {
    const ok = await confirm({
      title: t('archive_labels'),
      message: t('archive_label_delete_confirm'),
      confirmLabel: t('storage_delete_confirm'),
      cancelLabel: t('common_cancel'),
    });
    if (ok && !(await removeLabel(id))) showToast(t('archive_label_save_failed'), 'error');
  };

  return {
    addingLabel, setAddingLabel,
    savingNewLabel: saving.has(''),
    savingEditedLabel: editingLabelId !== null && saving.has(editingLabelId),
    newLabelName, setNewLabelName,
    newLabelColor, setNewLabelColor,
    editingLabelId, setEditingLabelId: openEditing,
    editLabelName, setEditLabelName,
    editLabelColor, setEditLabelColor,
    handleAddLabel,
    handleUpdateLabel,
    requestDeleteLabel,
  };
}
