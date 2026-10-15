import { useEffect, useRef } from 'react';

/**
 * MB-9 (F-29, D1): «назад» закрывает открытую панель, а не уводит из
 * приложения.
 *
 * На телефоне в PWA-режиме аппаратная «назад» и свайп iOS — единственный путь
 * назад, и до правки он вёл на предыдущий сайт: листы и панель настроек
 * открывались без записи в историю. Открытие кладёт свою запись, закрытие
 * кнопкой или по подложке снимает её (мёртвых записей не копится), popstate
 * закрывает панель. Вложенность работает стеком: «назад» снимает только верхнюю.
 *
 * enabled = false (десктопный макет) — ничего не происходит, поведение прежнее.
 */
// MF-11: запись, которую закрывшаяся панель собиралась снять. Если в том же
// действии открывается следующая панель (лист действий → лист переименования),
// она занимает эту запись replaceState'ом, а не кладёт свою поверх: иначе
// асинхронный popstate от history.back() закрывал бы новую панель сразу.
let pendingBack: string | null = null;

export function usePanelHistory(open: boolean, onClose: () => void, enabled: boolean): void {
  const idRef = useRef<string | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!enabled || !open) return;
    const id = `jw-panel-${Math.random().toString(36).slice(2)}`;
    idRef.current = id;
    const prev = (window.history.state ?? {}) as Record<string, unknown>;
    if (pendingBack !== null && prev.jwPanel === pendingBack) {
      pendingBack = null;
      window.history.replaceState({ ...prev, jwPanel: id }, '');
    } else {
      window.history.pushState({ ...prev, jwPanel: id }, '');
    }

    const onPopState = (e: PopStateEvent) => {
      const state = e.state as { jwPanel?: string } | null;
      // Нашей записи наверху больше нет — значит «назад» пришёл из этой панели.
      if (idRef.current !== null && state?.jwPanel !== idRef.current) {
        idRef.current = null;
        closeRef.current();
      }
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('popstate', onPopState);
      const state = window.history.state as { jwPanel?: string } | null;
      const ours = idRef.current;
      idRef.current = null;
      // Закрыли сами — снимаем свою запись. Если её уже снял popstate, назад не идём.
      // Снятие откладывается на такт: панель, открытая в том же действии, заберёт запись.
      if (ours !== null && state?.jwPanel === ours) {
        pendingBack = ours;
        setTimeout(() => {
          if (pendingBack !== ours) return;
          pendingBack = null;
          if ((window.history.state as { jwPanel?: string } | null)?.jwPanel === ours) window.history.back();
        }, 0);
      }
    };
  }, [enabled, open]);
}
