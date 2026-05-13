import { useState} from 'react';
import { DocumentService } from '../../writing/services/DocumentService';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';

export function useTagEditor(userId: string, fetchSessions: () => Promise<void>) {
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameTagValue, setRenameTagValue] = useState('');
  const [tagDeleteConfirm, setTagDeleteConfirm] = useState<string | null>(null);

  const handleRenameTag = async (tag: string, newName: string) => {
    const trimmed = newName.trim();
    if (trimmed && trimmed !== tag) {
      if (!userId.startsWith('guest')) {
        DocumentService.renameTagInAllDocs(userId, tag, trimmed).catch(() => {});
      }
      LocalDocumentService.renameTagInAllDocs(userId, tag, trimmed).then(() => fetchSessions()).catch(() => {});
    }
    setRenamingTag(null);
  };

  const handleDeleteTag = () => {
    if (!userId.startsWith('guest')) {
      DocumentService.removeTagFromAllDocs(userId, tagDeleteConfirm!).catch(() => {});
    }
    LocalDocumentService.removeTagFromAllDocs(userId, tagDeleteConfirm!).then(() => fetchSessions()).catch(() => {});
    setTagDeleteConfirm(null);
  };

  const startRenameTag = (tag: string) => {
    setRenamingTag(tag);
    setRenameTagValue(tag);
  };

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
