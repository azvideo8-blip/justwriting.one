import type { LocalDocument } from '../storage/localDb';

// AUDIT-part2 5.1: статус документа выводится из комбинации флагов ровно в
// ОДНОМ месте. Каждый найденный аудит-баг (H3 воскрешение, MH4 orphan) был
// ошибкой интерпретации этой комбинации в новом месте; единый переход
// flags -> status делает третий вариант прочтения невозможным.

export type SyncStatus =
  | 'linked'          // привязан к облачной копии
  | 'unlinked-new'    // никогда не выгружался / кандидат на выгрузку
  | 'local-only'      // осознанно отвязан (например, удалён в облаке)
  | 'locked'          // сейф закрыт — содержимое недоступно
  | 'unreadable';     // расшифровка не удалась

export function syncStatusOf(doc: LocalDocument): SyncStatus {
  if (doc._decryptionError) return 'unreadable';
  if (doc._locked) return 'locked';
  if (doc.localOnly || doc.isTooLargeForSync) return 'local-only';
  return doc.linkedCloudId ? 'linked' : 'unlinked-new';
}
