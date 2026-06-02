import { useState} from 'react';
import { LABEL_PRESET_COLORS } from '../../../core/constants/labelColors';

export function useLabelEditor({
  addLabel,
  updateLabel,
  removeLabel,
}: {
  addLabel: (label: { name: string; color: string }) => void;
  updateLabel: (id: string, updates: { name: string; color: string }) => void;
  removeLabel: (id: string) => void;
}) {
  const [addingLabel, setAddingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(LABEL_PRESET_COLORS[0] ?? '#7BA9F0');
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editLabelName, setEditLabelName] = useState('');
  const [editLabelColor, setEditLabelColor] = useState('');
  const [labelDeleteConfirm, setLabelDeleteConfirm] = useState<string | null>(null);

  const handleAddLabel = () => {
    const trimmed = newLabelName.trim();
    if (trimmed) {
      addLabel({ name: trimmed, color: newLabelColor });
      setNewLabelName('');
      setAddingLabel(false);
      setNewLabelColor(LABEL_PRESET_COLORS[0] ?? '#7BA9F0');
    }
  };

  const handleUpdateLabel = (id: string) => {
    const trimmed = editLabelName.trim();
    if (trimmed) {
      updateLabel(id, { name: trimmed, color: editLabelColor });
    }
    setEditingLabelId(null);
  };

  const confirmDeleteLabel = () => {
    if (labelDeleteConfirm) {
      removeLabel(labelDeleteConfirm);
      setLabelDeleteConfirm(null);
    }
  };

  return {
    addingLabel, setAddingLabel,
    newLabelName, setNewLabelName,
    newLabelColor, setNewLabelColor,
    editingLabelId, setEditingLabelId,
    editLabelName, setEditLabelName,
    editLabelColor, setEditLabelColor,
    labelDeleteConfirm, setLabelDeleteConfirm,
    handleAddLabel,
    handleUpdateLabel,
    confirmDeleteLabel,
  };
}
