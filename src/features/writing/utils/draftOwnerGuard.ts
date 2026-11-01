import { useContentStore } from '../store/useContentStore';

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
 * Ничего в хранилища не пишет: читает владельца из стора текста и, если
 * владельца не было, проставляет его — ровно так, как это делала ветка
 * `opts?.rescue === false` в `useDraftAutosave`.
 */
export function mayAccountWriteEditorText(uid: string, textToWrite: string): boolean {
  const contentState = useContentStore.getState();
  const owner = contentState.ownerUid;
  // Владелец текста — другой аккаунт: этим текстом занимается спасение для его
  // владельца (W6), подписывать его текущему аккаунту нельзя.
  if (owner && !isUnowned(owner) && owner !== uid) return false;
  if (isUnowned(owner)) {
    // Владельца нет, а в сторе уже другой текст, чем несёт этот писатель, —
    // это хвост чужой сессии (спасение очистило стор): текущему аккаунту он не
    // принадлежит.
    if (contentState.content !== textToWrite) return false;
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
  if (contentState.ownerUid !== uid) useContentStore.setState({ ownerUid: uid });
}
