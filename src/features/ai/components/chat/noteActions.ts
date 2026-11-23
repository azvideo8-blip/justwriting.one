import { StorageService } from '../../../../core/services/StorageService';
import { SyncService } from '../../../../core/services/SyncService';
import { emitDomainEvent } from '../../../../core/events/domainEvents';
import { countWords } from '../../../../shared/utils/countWords';

interface NoteActionsDeps {
  userId: string;
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void;
  t: (key: string) => string;
}

export function createNoteActions({ userId, showToast, t }: NoteActionsDeps) {
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
      emitDomainEvent({ type: 'note.saved', documentId: localId, userId });

      // NB-4: задача очереди — обещание «в облаке». Не встала — предупреждение
      // «сохранено на устройстве, в облако позже», а не зелёный успех.
      let queued = true;
      if (!userId.startsWith('guest')) {
        try {
          await SyncService.addToQueue(localId, userId);
        } catch (queueErr) {
          queued = false;
          console.error('AI note create: failed to enqueue sync task', queueErr);
        }
      }
      // Прямая выгрузка — и при отказе очереди: второй шанс, как при импорте (ревью 0.11.24).
      if (!userId.startsWith('guest')) {
        void SyncService.syncOne(userId, localId).catch((syncErr) => {
          console.warn('AI note create: cloud sync failed, task remains in syncQueue', syncErr);
        });
      }
      if (!queued) {
        showToast(t('save_local_only_queued'), 'warning');
        return;
      }
      showToast('Заметка успешно создана', 'success');
    } catch (e) {
      console.error('Failed to create note from assistant reply:', e);
      showToast('Не удалось создать заметку', 'error');
    }
  };

  return { handleCreateNote };
}
