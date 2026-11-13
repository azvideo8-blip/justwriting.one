/**
 * Постоянный номер заметки, под которым производная (разбор, вектор) уходит в
 * облако. `null` — отправлять нечего: политика доступа требует существующую
 * заметку с этим номером, и под локальным `local_…` строку не примет.
 *
 * Одно правило на выгрузку и на панель расхождения (drift-1). Если их развести,
 * панель посчитает отправляемым то, что выгрузка отклоняет, и будет вечно
 * показывать расхождение, которое нечем закрыть.
 */
export function canonicalDocumentId(
  rec: { documentUuid?: string | undefined },
  doc: { uuid?: string | undefined } | undefined,
): string | null {
  return rec.documentUuid || doc?.uuid || null;
}

/**
 * CX-5: id заметок прошлого ответа → id этого устройства. Ответ мог прийти с
 * другого устройства: там у заметки свой местный id, общий номер — в таблице
 * ответа `citeRefs` (uuid или облачный id). Свой id остаётся как есть; не
 * нашлось — тоже как есть (дальше заметку не найдут, как и раньше). Отбор
 * скрытых — у получателя, не здесь.
 */
export function localDocIds(
  ids: readonly string[] | undefined,
  refs: Record<string, string> | undefined,
  docs: ReadonlyArray<{ id: string; uuid?: string | undefined; linkedCloudId?: string | undefined; trashedAt?: number | null | undefined }>,
): string[] | undefined {
  if (!ids) return undefined;
  const own = new Set(docs.map(d => d.id));
  return ids.map(id => {
    const ref = own.has(id) ? undefined : refs?.[id];
    const doc = ref ? docs.find(d => !d.trashedAt && (d.uuid === ref || d.linkedCloudId === ref)) : undefined;
    return doc?.id ?? id;
  });
}
