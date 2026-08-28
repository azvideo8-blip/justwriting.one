import type { Session, Label, ArchiveSession } from '../../../shared/types/common';

export type { Session, Label };
// ArchiveSession переехал в shared/types/common: его используют чат, экспорт и
// архив, и из фичи он делал каждого потребителя cross-feature импортом.
// Ре-экспорт оставлен, чтобы код архива не трогать.
export type { ArchiveSession };
