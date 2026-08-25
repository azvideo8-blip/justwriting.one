import { StorageService } from '../../../../core/services/StorageService';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { countWords } from '../../../../shared/utils/countWords';

interface NoteActionsDeps {
  userId: string;
  linkedDocId: string | undefined;
  showToast: (message: string, type: 'success' | 'error') => void;
}

export function createNoteActions({ userId, linkedDocId, showToast }: NoteActionsDeps) {
  const handleCreateNote = async (text: string) => {
    try {
      const cleanText = text.replace(/<[^>]+>/g, '').trim();
      const firstLine = cleanText.split('\n')[0] || '';
      const noteTitle = firstLine.substring(0, 50).trim() || 'Без названия';
      const words = countWords(cleanText);

      const saveData = {
        title: noteTitle,
        content: cleanText,
        wordCount: words,
        duration: 0,
        wpm: 0,
        tags: ['ИИ'],
        sessionStartedAt: new Date(),
      };

      await StorageService.saveNew(userId, saveData);
      showToast('Заметка успешно создана', 'success');
    } catch (e) {
      console.error('Failed to create note from assistant reply:', e);
      showToast('Не удалось создать заметку', 'error');
    }
  };

  const handleApplyToNote = async (text: string) => {
    if (!linkedDocId) {
      showToast('Нет связанной заметки', 'error');
      return;
    }
    try {
      const cleanText = text.replace(/<[^>]+>/g, '').trim();
      const currentDoc = await LocalDocumentService.getDocument(linkedDocId);
      if (!currentDoc) {
        showToast('Заметка не найдена', 'error');
        return;
      }
      const words = countWords(cleanText);

      const saveData = {
        title: currentDoc.title || 'Без названия',
        content: cleanText,
        wordCount: words,
        duration: 0,
        wpm: 0,
        tags: currentDoc.tags,
        mood: currentDoc.mood,
        labelId: currentDoc.labelId,
        sessionStartedAt: new Date(),
      };

      await StorageService.saveVersion(userId, linkedDocId, saveData);
      showToast('Заметка обновлена новым вариантом', 'success');
    } catch (e) {
      console.error('Failed to apply reply to note:', e);
      showToast('Не удалось обновить заметку', 'error');
    }
  };

  return { handleCreateNote, handleApplyToNote };
}
