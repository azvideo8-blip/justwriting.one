import type { LocalDocument } from '../../../core/storage/localDb';

/** Метка отказа выгрузки: заметка снята с облака, производные остаются на устройстве. */
export const LOCAL_ONLY_DOCUMENT = 'LOCAL_ONLY_DOCUMENT';

/**
 * Можно ли выгружать разбор и вектор этой заметки.
 *
 * Заметку, снятую с облака (`unlinkFromCloud`: сам человек или надгробие),
 * держит у себя только устройство. Её номер в облаке принадлежит могиле, и с
 * 0035 база отвергает производные под надгробием навсегда: разбор сыпал бы
 * `ai_summary_cloud_save` на каждом пересчёте, вектор висел бы в очереди
 * выгрузки вечно. Тот же признак пропускает `SyncService` для самих заметок.
 *
 * Заметки нет на устройстве — не отказ: на втором устройстве она может жить
 * только в облаке, и это решает `canonicalDocumentId`, а не мы.
 */
export function canUploadDerivatives(
  doc: Pick<LocalDocument, 'localOnly' | 'unlinkedByTombstone'> | undefined,
): boolean {
  return !doc?.localOnly && !doc?.unlinkedByTombstone;
}
