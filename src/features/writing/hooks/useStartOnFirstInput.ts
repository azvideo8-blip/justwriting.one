import { useCallback, type RefObject } from 'react';

interface StartOnFirstInput {
  /** Статус сессии: пока 'idle' или 'paused', первый ввод должен начать запись. */
  status: string;
  play: RefObject<() => void>;
  /** Счётчик живости набора — только для печатающих без модификаторов. */
  onKeystroke?: () => void;
}

/**
 * Начало сессии по первому символу: один закон для десктопа и телефона.
 * Отдельный «Начать» на телефоне был лишним экраном (направление A).
 */
export function useStartOnFirstInput({ status, play, onKeystroke }: StartOnFirstInput) {
  const starts = status === 'idle' || status === 'paused';

  const handleEditorKeyDown = useCallback((e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey?: boolean }) => {
    if (!e.metaKey && !e.ctrlKey && !e.altKey) onKeystroke?.();
    if (starts && e.key.length === 1 && !e.metaKey && !e.ctrlKey) play.current?.();
  }, [starts, play, onKeystroke]);

  const handleEditorInput = useCallback((e: { target: EventTarget | null }) => {
    if (!starts) return;
    const value = (e.target as HTMLTextAreaElement | null)?.value ?? '';
    if (value.length > 0) play.current?.();
  }, [starts, play]);

  return { handleEditorKeyDown, handleEditorInput };
}
