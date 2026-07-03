import { useEffect, RefObject } from 'react';

function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const cs = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 2) {
      return node;
    }
    node = node.parentElement;
  }
  const doc = document.scrollingElement as HTMLElement | null;
  return doc && doc.scrollHeight > doc.clientHeight + 2 ? doc : null;
}

/**
 * Caret-anchored editor effects driven by one hidden mirror measurement:
 * - typewriter: keeps the caret line vertically centered, scrolling either the
 *   textarea itself or (when the textarea auto-grows) its scrollable ancestor;
 * - focusBand: exposes the caret position as --focus-y (%) on the textarea so
 *   CSS can keep the focus-mode mask centered on the line being written.
 */
export function useCaretEffects(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  opts: { typewriter: boolean; focusBand: boolean }
) {
  const { typewriter, focusBand } = opts;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || (!typewriter && !focusBand)) return;

    const cs = window.getComputedStyle(textarea);

    const mirror = document.createElement('div');
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.boxSizing = 'border-box';
    mirror.style.font = cs.font;
    mirror.style.fontSize = cs.fontSize;
    mirror.style.fontFamily = cs.fontFamily;
    mirror.style.fontWeight = cs.fontWeight;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.padding = cs.padding;
    mirror.style.border = cs.border;
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.style.height = 'auto';
    mirror.style.overflow = 'hidden';
    mirror.style.top = '0';
    mirror.style.left = '-9999px';
    mirror.style.pointerEvents = 'none';
    document.body.appendChild(mirror);

    let rafId: number | null = null;

    const apply = () => {
      rafId = null;
      const ta = textareaRef.current;
      if (!ta) return;
      // Keep the mirror width in sync so soft wraps match.
      mirror.style.width = `${ta.clientWidth}px`;
      mirror.textContent = ta.value.slice(0, ta.selectionStart);
      const marker = document.createElement('span');
      marker.textContent = '​';
      mirror.appendChild(marker);
      const caretY = marker.offsetTop;
      mirror.removeChild(marker);
      const lineHeight = parseFloat(cs.lineHeight) || 24;

      if (typewriter) {
        if (ta.scrollHeight > ta.clientHeight + 2) {
          // Textarea scrolls internally.
          ta.scrollTop = Math.max(0, caretY - ta.clientHeight * 0.45 + lineHeight * 0.5);
        } else {
          // Auto-growing textarea: scroll the nearest scrollable ancestor.
          const scroller = findScrollParent(ta);
          if (scroller) {
            const scrollerRect = scroller === document.scrollingElement
              ? { top: 0 }
              : scroller.getBoundingClientRect();
            const caretAbs = ta.getBoundingClientRect().top - scrollerRect.top + scroller.scrollTop + caretY;
            scroller.scrollTop = Math.max(0, caretAbs - scroller.clientHeight * 0.45 + lineHeight * 0.5);
          }
        }
      }

      if (focusBand) {
        const visibleY = caretY - ta.scrollTop + lineHeight * 0.5;
        ta.style.setProperty('--focus-y', `${Math.max(0, Math.round(visibleY))}px`);
      }
    };

    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(apply);
    };

    textarea.addEventListener('input', schedule);
    textarea.addEventListener('click', schedule);
    textarea.addEventListener('keyup', schedule);
    document.addEventListener('selectionchange', schedule);

    schedule();

    return () => {
      textarea.removeEventListener('input', schedule);
      textarea.removeEventListener('click', schedule);
      textarea.removeEventListener('keyup', schedule);
      document.removeEventListener('selectionchange', schedule);
      if (rafId !== null) cancelAnimationFrame(rafId);
      mirror.remove();
      textarea.style.removeProperty('--focus-y');
    };
  }, [textareaRef, typewriter, focusBand]);
}
