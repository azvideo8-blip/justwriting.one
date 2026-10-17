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
    let lastScrollTop = endRef.current?.closest<HTMLElement>('[data-chat-scroll]')?.scrollTop ?? 0;
    const recheck = (e: Event) => {
      const box = endRef.current?.closest<HTMLElement>('[data-chat-scroll]');
      if (!box || !(e.target instanceof Node) || !box.contains(e.target)) return;
      // N-14 (emil-review, хвост MQ-15): при быстром смахивании последний
      // touchmove приходит ещё в 80 px от низа, `following` оставался `true`, и
      // следующий кусок потока уводил читателя вниз, обрывая инерцию iOS. По
      // событию `scroll` уход видно по настоящему движению: сбрасываем только
      // когда человек поехал ВВЕРХ и оказался от низа дальше порога. Своё
      // прокручивание вниз (`scrollIntoView`) при этом ничего не снимает.
      if (e.type === 'scroll') {
        const top = box.scrollTop;
        const upward = top < lastScrollTop - 1;
        lastScrollTop = top;
        if (upward && box.scrollHeight - top - box.clientHeight > NEAR_BOTTOM_PX) following.current = false;
        return;
      }
      lastScrollTop = box.scrollTop;
      // После события позиция уже обновлена браузером.
      requestAnimationFrame(() => {
        following.current = box.scrollHeight - box.scrollTop - box.clientHeight <= NEAR_BOTTOM_PX;
      });
    };
    const events = ['wheel', 'touchmove', 'keydown', 'scroll'] as const;
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
