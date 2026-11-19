/**
 * Правило I3 хаос-теста двух устройств (владелец 19.11, разбор
 * justwriting-docs/chaos-remainder-0-11-16.md).
 *
 * Правка, которой удаление не видело, сохраняется копией вместе со старым
 * текстом — это задумано (иначе текст, написанный без сети, пропал бы молча).
 * Ошибка — живая копия с удалённым текстом без такой правки. «Не видело» —
 * текст копии записан раньше, чем копия появилась в облаке; правка ожившей
 * копии задним числом её не оправдывает.
 */
export interface CloudVersionText { uuid: string; text: string }

/** Шаг из имени текста `<устройство>-<сид>-<шаг>`; исходный `start-<сид>` — до шага 0. */
export function stepOfText(text: string): number {
  if (text.startsWith('start-')) return -1;
  const m = /-(\d+)$/.exec(text);
  return m ? Number(m[1]) : Infinity;
}

export function unexcusedRevivals(args: {
  versions: readonly CloudVersionText[];
  liveUuids: ReadonlySet<string>;
  deleted: ReadonlySet<string>;
  /** Тексты, которые до удаления уже жили в другой копии, — не воскрешение. */
  copiesBeforeDeletion: ReadonlyMap<string, ReadonlySet<string>>;
  /** Шаг, на котором копия впервые появилась в облаке. */
  firstSeen: ReadonlyMap<string, number>;
  steps: number;
}): string[] {
  const { versions, liveUuids, deleted, copiesBeforeDeletion, firstSeen, steps } = args;
  const hasUnseenEdit = (uuid: string) => {
    const born = firstSeen.get(uuid) ?? steps;
    return versions.some(v => v.uuid === uuid && !deleted.has(v.text) && stepOfText(v.text) < born);
  };
  return versions
    .filter(v => liveUuids.has(v.uuid) && deleted.has(v.text) && !copiesBeforeDeletion.get(v.text)?.has(v.uuid) && !hasUnseenEdit(v.uuid))
    .map(v => v.text);
}
