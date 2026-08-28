import type { Session, Label, ArchiveSession, ExportStrings } from '../../../shared/types/common';

export type { Session, Label };
// ArchiveSession и ExportStrings переехали в shared/types/common: их используют
// чат, экспорт, настройки и архив. Ре-экспорт оставлен для обратной совместимости.
export type { ArchiveSession, ExportStrings };
