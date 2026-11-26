import { AIPanel } from '../../features/ai/components/AIPanel';
import { useContentStore } from '../../features/writing/store/useContentStore';
import { useSessionMetaStore } from '../../features/writing/store/useSessionMetaStore';

// Мобильная ИИ-панель без текста заметки держала все шесть действий выключенными
// (R3-020). Подписка на текст здесь, а не в раскладке, как на десктопе (EA-9).
export function LiveAIPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const content = useContentStore(s => s.content);
  const setContent = useContentStore(s => s.setContent);
  // HA-1: та же заметка, что у диктовки (useDictation) — скрытую панель модели не отдаёт.
  const documentId = useSessionMetaStore(s => s.savedDocumentId);
  return <AIPanel open={open} onClose={onClose} content={content} onApplyContent={setContent} documentId={documentId} />;
}
