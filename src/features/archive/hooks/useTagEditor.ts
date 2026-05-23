import { useState, useCallback } from 'react';
import { DocumentService } from '../../writing/services/DocumentService';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { useToast } from '../../../shared/components/Toast';
import { useLanguage } from '../../../core/i18n';
import { reportError } from '../../../core/errors/reportError';

export function useTagEditor(userId: string, fetchSessions: () => Promise<void>) {
  const { showToast } = useToast();
  const { t } = useLanguage();

  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameTagValue, setRenameTagValue] = useState('');
  const [tagDeleteConfirm, setTagDeleteConfirm] = useState<string | null>(null);

  const handleRenameTag = useCallback(async (tag: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === tag) {
      setRenamingTag(null);
      return;
    }

    try {
      const promises: Promise<any>[] = [
        LocalDocumentService.renameTagInAllDocs(userId, tag, trimmed),
      ];
      if (userId && !userId.startsWith('guest')) {
        promises.push(DocumentService.renameTagInAllDocs(userId, tag, trimmed));
      }
      await Promise.all(promises);
      await fetchSessions();
      showToast(t('tag_renamed') || 'Tag renamed', 'success');
    } catch (err) {
      reportError(err, { action: 'renameTag', tag, newTag: trimmed });
      showToast(t('error_tag_rename_failed') || 'Failed to rename tag', 'error');
    } finally {
      setRenamingTag(null);
    }
  }, [userId, fetchSessions, showToast, t]);

  const handleDeleteTag = useCallback(async () => {
    if (!tagDeleteConfirm) return;

    try {
      const promises: Promise<any>[] = [
        LocalDocumentService.removeTagFromAllDocs(userId, tagDeleteConfirm),
      ];
      if (userId && !userId.startsWith('guest')) {
        promises.push(DocumentService.removeTagFromAllDocs(userId, tagDeleteConfirm));
      }
      await Promise.all(promises);
      await fetchSessions();
      showToast(t('tag_deleted') || 'Tag deleted', 'success');
    } catch (err) {
      reportError(err, { action: 'deleteTag', tag: tagDeleteConfirm });
      showToast(t('error_tag_delete_failed') || 'Failed to delete tag', 'error');
    } finally {
      setTagDeleteConfirm(null);
    }
  }, [userId, tagDeleteConfirm, fetchSessions, showToast, t]);

  const startRenameTag = useCallback((tag: string) => {
    setRenamingTag(tag);
    setRenameTagValue(tag);
  }, []);

  return {
    renamingTag,
    setRenamingTag,
    renameTagValue,
    setRenameTagValue,
    tagDeleteConfirm,
    setTagDeleteConfirm,
    handleRenameTag,
    handleDeleteTag,
    startRenameTag,
  };
}
