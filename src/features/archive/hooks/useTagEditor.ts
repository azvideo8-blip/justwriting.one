import { useState, useCallback } from 'react';
import { DocumentService } from '../../../core/services/DocumentService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { useToast } from '../../../shared/components/Toast';
import { useLanguage } from '../../../shared/i18n';
import { reportError } from '../../../shared/errors/reportError';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';

export function useTagEditor(userId: string, fetchSessions: () => Promise<void>) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { confirm } = useConfirmDialog();

  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameTagValue, setRenameTagValue] = useState('');

  const handleRenameTag = useCallback(async (tag: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === tag) {
      setRenamingTag(null);
      return;
    }

    try {
      const promises: Promise<unknown>[] = [
        LocalDocumentService.renameTagInAllDocs(userId, tag, trimmed),
      ];
      if (userId && !userId.startsWith('guest')) {
        promises.push(DocumentService.renameTagInAllDocs(userId, tag, trimmed));
      }
      await Promise.all(promises);
      await fetchSessions();
      showToast(t('tag_renamed'), 'success');
    } catch (err) {
      reportError(err, { action: 'renameTag', tag, newTag: trimmed });
      showToast(t('error_tag_rename_failed'), 'error');
    } finally {
      setRenamingTag(null);
    }
  }, [userId, fetchSessions, showToast, t]);

  const requestDeleteTag = useCallback(async (tag: string) => {
    const ok = await confirm({
      title: t('archive_tags_label'),
      message: t('archive_tag_delete_confirm', { tag }),
      confirmLabel: t('storage_delete_confirm'),
      cancelLabel: t('common_cancel'),
    });
    if (!ok) return;

    try {
      const promises: Promise<unknown>[] = [
        LocalDocumentService.removeTagFromAllDocs(userId, tag),
      ];
      if (userId && !userId.startsWith('guest')) {
        promises.push(DocumentService.removeTagFromAllDocs(userId, tag));
      }
      await Promise.all(promises);
      await fetchSessions();
      showToast(t('tag_deleted'), 'success');
    } catch (err) {
      reportError(err, { action: 'deleteTag', tag });
      showToast(t('error_tag_delete_failed'), 'error');
    }
  }, [userId, fetchSessions, showToast, t, confirm]);

  const startRenameTag = useCallback((tag: string) => {
    setRenamingTag(tag);
    setRenameTagValue(tag);
  }, []);

  return {
    renamingTag,
    setRenamingTag,
    renameTagValue,
    setRenameTagValue,
    handleRenameTag,
    requestDeleteTag,
    startRenameTag,
  };
}
