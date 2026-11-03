import { useContentStore } from '../store/useContentStore';
import { getEditorTextOwner, markEditorTextOwner, takeRescuePayload } from '../services/draftWriter';

/** «Ничей» текст: нового документа, гостевой или уже спасённый у прежнего владельца. */
function isUnowned(owner: string | null | undefined): boolean {
  return !owner || owner.startsWith('guest');
}

/**
 * DW-9: сверка владельца текста перед любой записью черновика «текущим
 * аккаунтом». Правило одно (AS-1, N-47), а мест записи больше одного — запись
 * на размонтировании (`useDraftAutosave`) и запись при закрытии вкладки
 * (`useSyncUnloadSave`). Копию правила заводить нельзя: расходится.
 *
 * Гость вне правила: у гостевого текста владельца-аккаунта нет по смыслу
 * (`isGuest`, DW-6), и вызывающий обязан не звать помощника для гостя.
 *
 * DW4-4: владелец живёт в зеркале редактора (`draftWriter`), а не в сторе
 * текста: мутатор пишет адреса только названного владельца (I3), и источник
 * правила для помощника и для мутатора один. Запись в стор `ownerUid`
 * оставлена до шага 7 — там поле стора снимают вместе с последним читателем.
 */
export function mayAccountWriteEditorText(uid: string, textToWrite: string): boolean {
  const owner = getEditorTextOwner();
  // Владелец текста — другой аккаунт: этим текстом занимается спасение для его
  // владельца (W6), подписывать его текущему аккаунту нельзя.
  if (owner && !isUnowned(owner) && owner !== uid) return false;
  if (isUnowned(owner)) {
    // Владельца нет, а в сторе уже другой текст, чем несёт этот писатель, —
    // это хвост чужой сессии (спасение очистило стор): текущему аккаунту он не
    // принадлежит.
    if (useContentStore.getState().content !== textToWrite) return false;
    markEditorTextOwner(uid);
    useContentStore.setState({ ownerUid: uid });
  }
  return true;
}

/**
 * DW-9: владелец текста — тот аккаунт, который в него печатает. Пока владелец
 * проставлялся только записью (то есть после отсрочки), «владельца нет»
 * означало «текущий аккаунт», и любой писатель в этом окне подписывал чужой
 * текст собой (инвариант I6 из карты DW-2).
 *
 * Правка — это правка стора текста: текст, которого в сторе нет (пришедшие
 * props, устаревший рендер), присвоить себе нельзя. Вызывать её надо при
 * изменении текста, а не при монтировании: первый рендер экземпляра — не правка.
 */
export function markEditorTextOwnedBy(uid: string, editedContent: string): void {
  const contentState = useContentStore.getState();
  if (contentState.content !== editedContent) return;
  const current = getEditorTextOwner();
  if (current && !isUnowned(current) && current !== uid) {
    // Печать не присваивает буфер другого АККАУНТА: его ведёт спасение для
    // владельца (DW-F-3), и подпись печатью уводила бы смешанный буфер
    // печатающему (I3). Гостевой текст печатаемый — за ним приходит вход.
    return;
  }
  if (current === uid) {
    // Владелец снова печатает: снимок, ждущий его спасения, устарел — его место
    // займёт свежий, если смена аккаунта повторится.
    takeRescuePayload(uid);
  }
  if (current !== uid) markEditorTextOwner(uid);
  if (contentState.ownerUid !== uid) useContentStore.setState({ ownerUid: uid });
}
