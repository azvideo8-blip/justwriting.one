import { useState, useCallback } from 'react';
import { AIDialogueService } from '../services/AIDialogueService';
import type { AIDialogue } from '../../../core/storage/localDb';
import { useLanguage } from '../../../shared/i18n';
import { localDayKey } from '../../../core/utils/dateUtils';
import { reportError } from '../../../shared/errors/reportError';

interface DialogueManagerParams {
  confirmDialog: (options: { title: string; message: string }) => Promise<boolean>;
}

export function useDialogueManager({ confirmDialog }: DialogueManagerParams) {
  const { t } = useLanguage();
  const [dialogues, setDialogues] = useState<AIDialogue[]>([]);
  const [archivedDialogues, setArchivedDialogues] = useState<AIDialogue[]>([]);
  const [activeDialogueId, setActiveDialogueId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [dialoguesLoading, setDialoguesLoading] = useState(true);
  const [dialoguesLoadError, setDialoguesLoadError] = useState(false);

  const loadDialogues = useCallback(async () => {
    setDialoguesLoading(true);
    try {
      const [active, archived] = await Promise.all([
        AIDialogueService.list({ includeArchived: false }),
        AIDialogueService.list({ includeArchived: true }),
      ]);
      setDialogues(active);
      setArchivedDialogues(archived.filter(d => d.archivedAt));
      setDialoguesLoadError(false);
    } catch (error) {
      // A-1: сбой чтения — не «пусто»: прошлый список остаётся, экран говорит об ошибке.
      reportError(error, { action: 'loadDialogues', source: 'ai-dialogues' });
      setDialoguesLoadError(true);
    } finally {
      setDialoguesLoading(false);
    }
  }, []);

  const handleRenameDialogue = useCallback(async (id: string, newTitle: string) => {
    await AIDialogueService.updateTitle(id, newTitle);
    await loadDialogues();
  }, [loadDialogues]);

  // id по умолчанию — активный диалог (так вызывала шапка); лист MR-1 передаёт
  // id строки, чтобы архивировать и удалять не только текущий разговор.
  const handleArchive = useCallback(async (id?: string) => {
    const target = id ?? activeDialogueId;
    if (target) {
      await AIDialogueService.archive(target);
      if (target === activeDialogueId) setActiveDialogueId(null);
      await loadDialogues();
    }
  }, [activeDialogueId, loadDialogues]);

  const handleUnarchive = useCallback(async (id: string) => {
    await AIDialogueService.unarchive(id);
    await loadDialogues();
  }, [loadDialogues]);

  const handleDelete = useCallback(async (id?: string) => {
    const target = id ?? activeDialogueId;
    if (target) {
      const ok = await confirmDialog({
        title: t('ai_delete_dialogue_confirm_title'),
        message: t('ai_delete_dialogue_confirm_message'),
      });
      if (!ok) return;
      await AIDialogueService.delete(target);
      if (target === activeDialogueId) setActiveDialogueId(null);
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
    const dateStr = localDayKey();
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
    dialoguesLoading,
    dialoguesLoadError,
    loadDialogues,
    handleRenameDialogue,
    handleArchive,
    handleUnarchive,
    handleDelete,
    handleExport,
  };
}
