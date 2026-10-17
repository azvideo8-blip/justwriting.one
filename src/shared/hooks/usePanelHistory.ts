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

/**
 * Записи панелей в порядке push'а — он же порядок истории.
 * MF-11: следующая панель, открытая в том же действии, занимает верхнюю
 * освобождаемую запись replaceState'ом, а не кладёт свою поверх — иначе
 * асинхронный popstate от history.back() закрывал бы её сразу.
 * R7Q-027: закрывшиеся в одном действии панели образуют ПАЧКУ и освобождаются
 * вместе. Прежний одиночный слот pendingBack пропускал второй случай: у двух
 * снятых панелей освобождалась верхняя запись, нижняя оставалась мёртвой.
 */
const entries: Array<{ id: string; open: boolean }> = [];
const NAVIGATION_FALLBACK_MS = 500;
let closingBatch: string[] = [];
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Отпустить пачку записей закрывшихся панелей — но только если она лежит на
 * вершине истории: под курсором обязана быть запись из пачки, и выше неё
 * записей быть не должно. Если курсор уже на чужой записи (панель уехала из-под
 * навигации), назад идти нельзя: дыру посередине истории не вырежешь, а провал
 * в предыдущую страницу вместо редактора хуже мёртвой записи.
 */
function releaseClosingBatch(): void {
  releaseTimer = null;
  const batch = closingBatch;
  closingBatch = [];
  if (batch.length === 0) return;
  const cursor = (window.history.state as { jwPanel?: string } | null)?.jwPanel;
  const tail = entries[entries.length - 1];
  if (cursor === undefined || tail === undefined || tail.id !== cursor || !batch.includes(cursor)) return;

  // Только сплошной хвост закрытых записей: если между ними лежит запись
  // открытой панели, уход назад на всю пачку снял бы и её — и закрыл панель
  // (ревью 0.10.0). Нижние закрытые записи остаются мёртвыми — это меньшее зло.
  let depth = 0;
  for (let top = entries[entries.length - 1]; top !== undefined && !top.open && batch.includes(top.id); top = entries[entries.length - 1]) {
    entries.pop();
    depth++;
  }
  if (depth === 0) return;
  if (depth === 1) window.history.back();
  else window.history.go(-depth);
}

export function usePanelHistory(open: boolean, onClose: () => void, enabled: boolean): void {
  const idRef = useRef<string | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!enabled || !open) return;
    const id = `jw-panel-${Math.random().toString(36).slice(2)}`;
    idRef.current = id;
    const prev = (window.history.state ?? {}) as Record<string, unknown>;
    const tail = entries[entries.length - 1];
    if (tail !== undefined && !tail.open && tail.id === prev.jwPanel && closingBatch.includes(tail.id)) {
      // Освобождаемая запись — верхняя и она же под курсором: занимаем её.
      const i = closingBatch.indexOf(tail.id);
      if (i >= 0) closingBatch.splice(i, 1);
      tail.id = id;
      tail.open = true;
      window.history.replaceState({ ...prev, jwPanel: id }, '');
    } else {
      window.history.pushState({ ...prev, jwPanel: id }, '');
      entries.push({ id, open: true });
    }

    const onPopState = (e: PopStateEvent) => {
      const state = e.state as { jwPanel?: string } | null;
      // Нашей записи наверху больше нет — значит «назад» пришёл из этой панели.
      if (idRef.current !== null && state?.jwPanel !== idRef.current) {
        const i = entries.findIndex(x => x.id === idRef.current);
        if (i >= 0) entries.splice(i, 1);
        const b = closingBatch.indexOf(idRef.current);
        if (b >= 0) closingBatch.splice(b, 1);
        idRef.current = null;
        closeRef.current();
      }
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('popstate', onPopState);
      const ours = idRef.current;
      idRef.current = null;
      if (ours === null) return;
      const rec = entries.find(x => x.id === ours);
      // Записи нет — её уже снял popstate, идти назад второй раз нельзя.
      if (rec === undefined || !rec.open) return;
      rec.open = false;
      closingBatch.push(ours);
      if (releaseTimer === null) releaseTimer = setTimeout(releaseClosingBatch, 0);
    };
  }, [enabled, open]);
}

/**
 * R7Q-027: уйти по ссылке, когда открыта панель.
 *
 * Записи истории, оставшиеся ПОЗАДИ текущей, не удаляемы: `history.go` умеет
 * только переставлять курсор, а лишние записи браузер выбрасывает сам, когда
 * сверху делают push. Значит переход обязан сначала снять записи открытых
 * панелей (назад на всю ленту) и только потом класть свою запись. Прежний
 * порядок — `navigate()` до `onClose()` — накрывал их записью роутера, и после
 * выхода из читалки два «назад» уходили в пустоту.
 */
export function closePanelsForNavigation(run: () => void): void {
  const depth = entries.filter(e => e.open || closingBatch.includes(e.id)).length;
  if (depth === 0) {
    run();
    return;
  }
  // Лента очищается здесь: панели, чьи записи освобождаются, в cleanup не
  // имеют права идти назад повторно.
  entries.length = 0;
  closingBatch = [];
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(fallback);
    window.removeEventListener('popstate', finish);
    run();
  };
  // popstate может не прийти (запись уже снята, go оказался пустым): переход
  // не должен молча пропасть — тогда он идёт по таймеру (ревью 0.10.0).
  const fallback = setTimeout(finish, NAVIGATION_FALLBACK_MS);
  window.addEventListener('popstate', finish);
  window.history.go(-depth);
}
