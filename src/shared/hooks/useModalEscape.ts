import { useEffect, useRef } from 'react';

type CloseHandler = () => void;
const handlerStack: CloseHandler[] = [];

function handleDocumentKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && handlerStack.length > 0) {
    e.stopImmediatePropagation();
    const top = handlerStack[handlerStack.length - 1];
    top?.();
  }
}

let listenerAttached = false;
function ensureListener() {
  if (!listenerAttached && typeof document !== 'undefined') {
    document.addEventListener('keydown', handleDocumentKeyDown);
    listenerAttached = true;
  }
}

function removeListenerIfEmpty() {
  if (listenerAttached && handlerStack.length === 0 && typeof document !== 'undefined') {
    document.removeEventListener('keydown', handleDocumentKeyDown);
    listenerAttached = false;
  }
}

export function useModalEscape(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;

    const handler: CloseHandler = () => {
      onCloseRef.current();
    };

    ensureListener();
    handlerStack.push(handler);

    return () => {
      const idx = handlerStack.lastIndexOf(handler);
      if (idx !== -1) {
        handlerStack.splice(idx, 1);
      }
      removeListenerIfEmpty();
    };
  }, [isOpen]);
}
