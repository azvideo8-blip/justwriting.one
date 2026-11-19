import { useState, useCallback } from 'react';
import { AIDialogueService } from '../services/AIDialogueService';
import type { AIDialogue } from '../../../core/storage/localDb';
import { useLanguage } from '../../../shared/i18n';
import { localDayKey } from '../../../core/utils/dateUtils';
import { reportError } from '../../../shared/errors/reportError';
import { runMutation } from '../../../shared/mutationResult';
import { useToast } from '../../../shared/components/Toast';
import { knownData, loadState, type LoadState } from '../../../shared/loadState';

/** Оба списка диалогов читаются одним чтением и живут в одном состоянии. */
export interface DialogueLists { active: AIDialogue[]; archived: AIDialogue[] }

interface DialogueManagerParams {
  confirmDialog: (options: { title: string; message: string }) => Promise<boolean>;
}

export function useDialogueManager({ confirmDialog }: DialogueManagerParams) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  // Одно состояние вместо dialogues / archivedDialogues / loading / loadError:
  // «Нет диалогов» нельзя нарисовать, не разобрав сбой чтения (shared/loadState).
  const [dialogueList, setDialogueList] = useState<LoadState<DialogueLists>>(loadState.loading());
  const [activeDialogueId, setActiveDialogueId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const loadDialogues = useCallback(async () => {
    // Повтор едет внутри состояния ошибки: экрану не из чего собрать ошибку без выхода.
    const retry = () => { void loadDialogues(); };
    // Прошлый список остаётся на экране, пока перечитываем.
    setDialogueList(prev => loadState.loading(knownData(prev)));
    try {
      const [active, archived] = await Promise.all([
        AIDialogueService.list({ includeArchived: false }),
        AIDialogueService.list({ includeArchived: true }),
      ]);
      setDialogueList(loadState.settled(
        { active, archived: archived.filter(d => d.archivedAt) },
        lists => lists.active.length === 0 && lists.archived.length === 0,
      ));
    } catch (error) {
      // A-1: сбой чтения — не «пусто»: прошлый список остаётся, экран говорит об ошибке.
      reportError(error, { action: 'loadDialogues', source: 'ai-dialogues' });
      setDialogueList(prev => loadState.error(retry, knownData(prev)));
    }
  }, []);

  // Дейлик 19.11, подозрение 2: вызовы — `void` из листа, который уже закрылся;
  // отказ базы был необработанным промисом без тоста. Общий runMutation называет
  // отказ; список перечитан (строка осталась на месте — так и показываем).
  const guarded = useCallback(async (action: string, fn: () => Promise<void>) => {
    await runMutation({ showToast, t }, action, fn, { successText: null, onFailure: loadDialogues });
  }, [loadDialogues, showToast, t]);

  const handleRenameDialogue = useCallback(async (id: string, newTitle: string) => guarded('dialogue_rename', async () => {
    await AIDialogueService.updateTitle(id, newTitle);
    await loadDialogues();
  }), [guarded, loadDialogues]);

  // id по умолчанию — активный диалог (так вызывала шапка); лист MR-1 передаёт
  // id строки, чтобы архивировать и удалять не только текущий разговор.
  const handleArchive = useCallback(async (id?: string) => guarded('dialogue_archive', async () => {
    const target = id ?? activeDialogueId;
    if (target) {
      await AIDialogueService.archive(target);
      if (target === activeDialogueId) setActiveDialogueId(null);
      await loadDialogues();
    }
  }), [activeDialogueId, guarded, loadDialogues]);

  const handleUnarchive = useCallback(async (id: string) => guarded('dialogue_unarchive', async () => {
    await AIDialogueService.unarchive(id);
    await loadDialogues();
  }), [guarded, loadDialogues]);

  const handleDelete = useCallback(async (id?: string) => guarded('dialogue_delete', async () => {
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
  }), [activeDialogueId, confirmDialog, guarded, loadDialogues, t]);

  const handleExport = useCallback(async () => {
    if (!activeDialogueId) return;
    const md = await AIDialogueService.exportAsMarkdown(activeDialogueId);
    if (!md) return;
    const known = knownData(dialogueList);
    const activeDialogue = known?.active.find(d => d.id === activeDialogueId) || known?.archived.find(d => d.id === activeDialogueId);
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
  }, [activeDialogueId, dialogueList]);

  return {
    dialogueList,
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
