import { useState} from 'react';
import { LABEL_PRESET_COLORS } from '../../../core/constants/labelColors';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';

export function useLabelEditor({
  addLabel,
  updateLabel,
  removeLabel,
}: {
  addLabel: (label: { name: string; color: string }) => Promise<boolean>;
  updateLabel: (id: string, updates: { name: string; color: string }) => Promise<boolean>;
  removeLabel: (id: string) => Promise<boolean>;
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
      if (!(await updateLabel(id, { name: trimmed, color: editLabelColor }))) {
        showToast(t('archive_label_save_failed'), 'error');
        return;
      }
    }
    setEditingLabelId(null);
  };

  const handleAddLabel = () => { void saveNewLabel(); };
  const handleUpdateLabel = (id: string) => { void saveEditedLabel(id); };

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
    newLabelName, setNewLabelName,
    newLabelColor, setNewLabelColor,
    editingLabelId, setEditingLabelId,
    editLabelName, setEditLabelName,
    editLabelColor, setEditLabelColor,
    handleAddLabel,
    handleUpdateLabel,
    requestDeleteLabel,
  };
}
