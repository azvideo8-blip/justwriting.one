import { StorageService } from '../../../../core/services/StorageService';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { SyncService } from '../../../../core/services/SyncService';
import { emitDomainEvent } from '../../../../core/events/domainEvents';
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

      const { localId } = await StorageService.saveNew(userId, saveData);
      showToast('Заметка успешно создана', 'success');
      emitDomainEvent({ type: 'note.saved', documentId: localId, userId });

      if (!userId.startsWith('guest')) {
        try {
          await SyncService.addToQueue(localId);
          void SyncService.syncOne(userId, localId).catch((syncErr) => {
            console.warn('AI note create: cloud sync failed, task remains in syncQueue', syncErr);
          });
        } catch (queueErr) {
          console.error('AI note create: failed to enqueue sync task', queueErr);
        }
      }
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

      const saveResult = await StorageService.saveVersion(userId, linkedDocId, saveData);
      showToast('Заметка обновлена новым вариантом', 'success');
      emitDomainEvent({ type: 'note.saved', documentId: linkedDocId, userId });

      if (!saveResult.cloudSynced && !userId.startsWith('guest')) {
        try {
          await SyncService.addToQueue(linkedDocId);
          void SyncService.syncOne(userId, linkedDocId).catch((syncErr) => {
            console.warn('AI note apply: cloud sync failed, task remains in syncQueue', syncErr);
          });
        } catch (queueErr) {
          console.error('AI note apply: failed to enqueue sync task', queueErr);
        }
      }
    } catch (e) {
      console.error('Failed to apply reply to note:', e);
      showToast('Не удалось обновить заметку', 'error');
    }
  };

  return { handleCreateNote, handleApplyToNote };
}
