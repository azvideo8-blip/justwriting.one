import { StorageService } from '../../../../core/services/StorageService';
import { SyncService } from '../../../../core/services/SyncService';
import { emitDomainEvent } from '../../../../core/events/domainEvents';
import { countWords } from '../../../../shared/utils/countWords';

interface NoteActionsDeps {
  userId: string;
  showToast: (message: string, type: 'success' | 'error') => void;
}

export function createNoteActions({ userId, showToast }: NoteActionsDeps) {
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

  return { handleCreateNote };
}
