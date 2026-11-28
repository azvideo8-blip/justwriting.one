/**
 * DA-11 (ревью): название, теги и метка заметки на момент, когда её открыли для
 * продолжения. Окно «Завершить» держит именно эти значения; за время сессии забор мог
 * принести правку с другого устройства в локальную строку, и сравнение со строкой
 * выдало бы старые значения окна за правку человека — откат чужой правки в облаке.
 * Сравниваем с тем, что человек видел при открытии. Нет записи (перезагрузили страницу
 * посреди сессии) — поля в облако отдельно не шлём, как до DA-11.
 */
export interface MetadataBase {
  title: string;
  tags: string[];
  labelId: string | undefined;
}

const bases = new Map<string, MetadataBase>();

export function rememberMetadataBase(documentId: string, base: MetadataBase): void {
  bases.set(documentId, { title: base.title, tags: [...base.tags], labelId: base.labelId });
}

export function getMetadataBase(documentId: string): MetadataBase | undefined {
  return bases.get(documentId);
}
