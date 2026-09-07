import { useState, useCallback } from 'react';
import { AIDialogueService } from '../services/AIDialogueService';
import type { AIDialogue } from '../../../core/storage/localDb';
import { useLanguage } from '../../../shared/i18n';

interface DialogueManagerParams {
  confirmDialog: (options: { title: string; message: string }) => Promise<boolean>;
}

export function useDialogueManager({ confirmDialog }: DialogueManagerParams) {
  const { t } = useLanguage();
  const [dialogues, setDialogues] = useState<AIDialogue[]>([]);
  const [archivedDialogues, setArchivedDialogues] = useState<AIDialogue[]>([]);
  const [activeDialogueId, setActiveDialogueId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const loadDialogues = useCallback(async () => {
    const [active, archived] = await Promise.all([
      AIDialogueService.list({ includeArchived: false }),
      AIDialogueService.list({ includeArchived: true }),
    ]);
    setDialogues(active);
    setArchivedDialogues(archived.filter(d => d.archivedAt));
  }, []);

  const handleRenameDialogue = useCallback(async (id: string, newTitle: string) => {
    await AIDialogueService.updateTitle(id, newTitle);
    await loadDialogues();
  }, [loadDialogues]);

  const handleArchive = useCallback(async () => {
    if (activeDialogueId) {
      await AIDialogueService.archive(activeDialogueId);
      setActiveDialogueId(null);
      await loadDialogues();
    }
  }, [activeDialogueId, loadDialogues]);

  const handleUnarchive = useCallback(async (id: string) => {
    await AIDialogueService.unarchive(id);
    await loadDialogues();
  }, [loadDialogues]);

  const handleDelete = useCallback(async () => {
    if (activeDialogueId) {
      const ok = await confirmDialog({
        title: t('ai_delete_dialogue_confirm_title'),
        message: t('ai_delete_dialogue_confirm_message'),
      });
      if (!ok) return;
      await AIDialogueService.delete(activeDialogueId);
      setActiveDialogueId(null);
      await loadDialogues();
    }
  }, [activeDialogueId, confirmDialog, loadDialogues, t]);

  const handleExport = useCallback(async () => {
    if (!activeDialogueId) return;
    const md = await AIDialogueService.exportAsMarkdown(activeDialogueId);
    if (!md) return;
    const activeDialogue = dialogues.find(d => d.id === activeDialogueId) || archivedDialogues.find(d => d.id === activeDialogueId);
    const rawTitle = activeDialogue?.title || 'dialogue';
    const safeTitle = rawTitle.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'dialogue';
    const dateStr = new Date().toISOString().split('T')[0];
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}-${dateStr}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeDialogueId, dialogues, archivedDialogues]);

  return {
    dialogues,
    setDialogues,
    archivedDialogues,
    setArchivedDialogues,
    activeDialogueId,
    setActiveDialogueId,
    showArchived,
    setShowArchived,
    loadDialogues,
    handleRenameDialogue,
    handleArchive,
    handleUnarchive,
    handleDelete,
    handleExport,
  };
}
