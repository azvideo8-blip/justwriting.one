import { useState } from 'react';
import type { ArchiveSession } from '../types';
import type { Label } from '../../../types';
import { useNoteStorageActions, type StorageDoc } from './useNoteStorageActions';
import { buildNoteActions, sectionsToMenuEntries, type NoteAIState } from './noteActions';
import type { MenuAnchor } from '../../../shared/components/Menu';

/** Строка и карточка заметки показывают одно и то же: цветные иконки копий и
 *  разбора плюс меню «⋯» (и контекстное). Всё это собирается здесь, чтобы два
 *  вида не разошлись по составу и обработчикам. */
export function useNoteMenu({
  session,
  userId,
  t,
  labels,
  onOpen,
  onRename,
  onAddTag,
  onDelete,
  onLabelChange,
  onStorageChange,
  aiProcessed,
  aiLoading,
  onAIClick,
  aiExclusionLoading,
  onAIExclusionClick,
}: {
  session: ArchiveSession;
  userId: string;
  t: (key: string) => string;
  labels?: Label[] | undefined;
  onOpen: () => void;
  onRename: () => void;
  onAddTag?: (() => void) | undefined;
  onDelete?: ((session: ArchiveSession) => void) | undefined;
  onLabelChange?: ((session: ArchiveSession, labelId: string | undefined) => void) | undefined;
  onStorageChange?: (() => void) | undefined;
  aiProcessed?: boolean | undefined;
  aiLoading?: boolean | undefined;
  onAIClick?: (() => void) | undefined;
  aiExclusionLoading?: boolean | undefined;
  onAIExclusionClick?: (() => void) | undefined;
}) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const doc: StorageDoc = {
    localId: session._isLocal ? session.id : undefined,
    cloudId: session._linkedCloudId,
    hasLocal: !!session._isLocal,
    hasCloud: !!session._hasCloudCopy,
    hasPendingSync: !!session._hasPendingSync,
    isTooLargeForSync: !!session._isTooLargeForSync,
    localOnly: !!session._localOnly,
  };
  const exclusion = onAIExclusionClick
    ? { excluded: !!session.excludedFromAI, loading: !!aiExclusionLoading, onClick: onAIExclusionClick }
    : undefined;
  const ai: NoteAIState | undefined = onAIClick
    ? { processed: !!aiProcessed, loading: !!aiLoading, onClick: onAIClick }
    : undefined;

  const storage = useNoteStorageActions({
    doc,
    userId,
    onStorageChange: () => onStorageChange?.(),
    ...(exclusion ? { exclusion } : {}),
  });

  const entries = sectionsToMenuEntries(buildNoteActions({
    t,
    doc,
    userId,
    storage,
    labels,
    currentLabelId: session.labelId,
    ...(onLabelChange ? { onLabelChange: (labelId: string | undefined) => onLabelChange(session, labelId) } : {}),
    onOpen,
    onRename,
    ...(onAddTag ? { onAddTag } : {}),
    ...(ai ? { ai } : {}),
    ...(exclusion ? { exclusion } : {}),
    onDelete: () => onDelete?.(session),
  }));

  return { doc, storage, ai, exclusion, entries, anchor, setAnchor };
}
