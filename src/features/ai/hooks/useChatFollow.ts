import { useEffect, useRef, type RefObject } from 'react';

const NEAR_BOTTOM_PX = 80;

/**
 * SA-12: плавная прокрутка на каждый кусок потока дрожала, игнорировала
 * reduced motion и тянула вниз того, кто прокрутил вверх дочитать.
 * Теперь: `smooth` один раз при отправке (и не при reduced motion), во время
 * потока — `auto`, и только пока человек у низа (≤ 80 px). Уход от низа
 * определяет только он сам — колесо, касание, клавиши; рост содержимого его не
 * сбрасывает.
 */
export function useChatFollow(
  endRef: RefObject<HTMLElement | null>,
  messageCount: number,
  lastRole: string | undefined,
  streamingMessage: string | null | undefined,
  dialogueId: string | null | undefined,
) {
  const following = useRef(true);
  const lastDialogue = useRef(dialogueId);

  useEffect(() => {
    const recheck = (e: Event) => {
      const box = endRef.current?.closest<HTMLElement>('[data-chat-scroll]');
      if (!box || !(e.target instanceof Node) || !box.contains(e.target)) return;
      // После события позиция уже обновлена браузером.
      requestAnimationFrame(() => {
        following.current = box.scrollHeight - box.scrollTop - box.clientHeight <= NEAR_BOTTOM_PX;
      });
    };
    const events = ['wheel', 'touchmove', 'keydown'] as const;
    events.forEach(ev => document.addEventListener(ev, recheck, { passive: true, capture: true }));
    return () => events.forEach(ev => document.removeEventListener(ev, recheck, { capture: true }));
  }, [endRef]);

  // Новое сообщение: своё — всегда вниз; ответ — только если человек не ушёл вверх.
  useEffect(() => {
    // Другой диалог читают с конца, как и новый.
    if (lastDialogue.current !== dialogueId) { lastDialogue.current = dialogueId; following.current = true; }
    if (lastRole === 'user') following.current = true;
    if (!following.current) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    endRef.current?.scrollIntoView({ behavior: lastRole === 'user' && !reduced ? 'smooth' : 'auto' });
  }, [endRef, messageCount, lastRole, dialogueId]);

  useEffect(() => {
    if (!following.current) return;
    endRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [endRef, streamingMessage]);
}
