import { useState, useEffect, useRef, useCallback } from 'react';
import type { AppUser } from '../../../core/auth/types';
import { loadAllSessions, loadSessionContent } from '../../../core/services/UnifiedSessionLoader';
import { ArchiveSession } from '../types';
import {
  updateArchiveField,
  deleteArchiveSession,
  trashArchiveSession,
  restoreArchiveSession,
  emptyTrash,
  pruneExpiredTrash,
} from '../services/archiveCrud';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';
import { logger } from '../../../shared/errors/logger';
import { useToast } from '../../../shared/components/Toast';
import { rebuildWordCloud } from './useArchiveWordCloud';

export function useArchiveSessions(user: AppUser | null, userId: string, t: (key: string) => string) {
  const [sessions, setSessions] = useState<ArchiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloudLoadFailed, setCloudLoadFailed] = useState(false);
  const [previewSession, setPreviewSession] = useState<ArchiveSession | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ArchiveSession | null>(null);
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState<ArchiveSession | null>(null);
  const [emptyTrashConfirm, setEmptyTrashConfirm] = useState<boolean>(false);
  const mountedRef = useRef(true);
  const isVaultUnlocked = useEncryptionStore(s => s.isVaultUnlocked);
  const prevVaultUnlockedRef = useRef(isVaultUnlocked);
  const { showToast } = useToast();

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await loadAllSessions(userId, user, { withContent: true });
      if (!mountedRef.current) return;
      const { remainingSessions } = await pruneExpiredTrash(result.sessions as ArchiveSession[], userId);
      if (!mountedRef.current) return;
      setSessions(remainingSessions);
      setCloudLoadFailed(result.cloudLoadFailed);

      if (user) {
        const untitledCloudNotes = remainingSessions.filter(s =>
          !s._isLocal && s._contentNotLoaded && !s.title?.trim() && !s._locked && !s._decryptionError
        ).slice(0, 10);
        if (untitledCloudNotes.length > 0) {
          void (async () => {
            for (const item of untitledCloudNotes) {
              if (!mountedRef.current) break;
              try {
                const flags = await loadSessionContent(user.uid, item.id);
                if (!mountedRef.current) break;
                if (flags._locked) {
                  flags._contentNotLoaded = true;
                }
                setSessions(prev => prev.map(s => s.id === item.id ? { ...s, ...flags } : s));
              } catch {
                // Non-critical background preview hydration
              }
            }
          })();
        }
      }
    } catch (err) {
      if (!mountedRef.current) return;
      logger.error('archive', 'Archive load error', { error: String(err) });
      setError(t('archive_load_error'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId, user, t]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetching when user/credentials change
    void fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    if (isVaultUnlocked && !prevVaultUnlockedRef.current) {
      void fetchSessions();
    }
    prevVaultUnlockedRef.current = isVaultUnlocked;
  }, [isVaultUnlocked, fetchSessions]);

  // Opening a cloud-only note is where its text is finally fetched: the list
  // skips that read for every note, so without this the preview shows a note
  // that is intact in the cloud as blank.
  const openPreview = useCallback(async (session: ArchiveSession) => {
    setPreviewSession(session);
    if (!session._contentNotLoaded || !user) return;
    const flags = await loadSessionContent(user.uid, session.id);
    if (!mountedRef.current) return;
    setSessions(prev => prev.map(s => s.id === session.id ? { ...s, ...flags } : s));
    setPreviewSession(prev => prev && prev.id === session.id ? { ...prev, ...flags } : prev);
  }, [user]);

  const updateSession = (id: string, patch: Partial<ArchiveSession>) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    setPreviewSession(prev => prev && prev.id === id ? { ...prev, ...patch } : prev);
  };

  const handleTrashSession = async (s: ArchiveSession) => {
    try {
      const now = Date.now();
      const res = await trashArchiveSession(s, userId);
      setSessions(prev => prev.map(x => x.id === s.id ? { ...x, trashedAt: now } : x));
      if (previewSession?.id === s.id) setPreviewSession(null);
      if (res.cloudSynced) {
        showToast(t('archive_trash_moved'), 'success');
      } else {
        showToast(t('delete_local_only_queued'));
      }
      void rebuildWordCloud(userId).catch(() => { /* non-critical */ });
    } catch (e) {
      logger.error('archive', 'Failed to trash session', { error: String(e) });
      showToast(t('error_delete_failed'), 'error');
    }
  };

  const handleRestoreSession = async (s: ArchiveSession) => {
    try {
      await restoreArchiveSession(s, userId); // намеренно: локальная заметка восстановлена, при сбое облака задача встаёт в очередь
      setSessions(prev => prev.map(x => x.id === s.id ? { ...x, trashedAt: undefined } : x));
      if (previewSession?.id === s.id) setPreviewSession(null);
      showToast(t('archive_trash_restored'), 'success');
      void rebuildWordCloud(userId).catch(() => { /* non-critical */ });
    } catch (e) {
      logger.error('archive', 'Failed to restore session', { error: String(e) });
      showToast(t('error_generic_action'), 'error');
    }
  };

  const handlePermanentDeleteSession = async (s: ArchiveSession) => {
    try {
      const res = await deleteArchiveSession(s, userId);
      if (!res.applied) {
        showToast(t('delete_not_applied_uploading'));
        return;
      }
      setSessions(prev => prev.filter(x => x.id !== s.id));
      if (previewSession?.id === s.id) setPreviewSession(null);
      if (res.cloudSynced && res.derivativesOk !== false) {
        showToast(t('session_deleted'), 'success');
      } else if (!res.cloudSynced) {
        showToast(t('delete_local_only_queued'));
      } else {
        showToast(t('session_deleted_partial'), 'warning');
      }
      void rebuildWordCloud(userId).catch(() => { /* non-critical */ });
    } catch (e) {
      logger.error('archive', 'Failed to delete session permanently', { error: String(e) });
      showToast(t('error_delete_failed'), 'error');
    }
  };

  const handleEmptyTrash = async (trashed: ArchiveSession[]) => {
    try {
      const { failCount, deletedIds } = await emptyTrash(trashed, userId);
      const gone = new Set(deletedIds);
      setSessions(prev => prev.filter(x => !gone.has(x.id)));
      // N-50: «корзина очищена» — только если действительно очищена.
      if (failCount > 0) showToast(t('archive_trash_partial').replace('{count}', String(failCount)), 'error');
      else showToast(t('archive_trash_cleared'), 'success');
      void rebuildWordCloud(userId).catch(() => { /* non-critical */ });
    } catch (e) {
      logger.error('archive', 'Failed to empty trash', { error: String(e) });
      showToast(t('error_delete_failed'), 'error');
    }
  };

  const handleDeleteSession = handleTrashSession;

  const handleFieldUpdate = async (
    session: ArchiveSession,
    field: 'tags' | 'title' | 'date' | 'labelId',
    value: string[] | string | Date | undefined
  ) => {
    try {
      const result = await updateArchiveField(session, field, value, user, userId);
      const patch: Partial<ArchiveSession> = {};
      if (field === 'tags' && Array.isArray(value)) patch.tags = value;
      else if (field === 'title' && typeof value === 'string') patch.title = value;
      else if (field === 'date' && value instanceof Date) {
        patch.createdAt = value;
        patch.sessionStartTime = value.getTime();
      } else if (field === 'labelId' && (typeof value === 'string' || value === undefined)) {
        patch.labelId = value;
      }
      updateSession(session.id, patch);
      if (result.cloudSyncFailed) {
        showToast(t('archive_cloud_sync_failed'), 'error');
      }
    } catch (e) {
      logger.error('archive', `Failed to update ${field}`, { error: String(e) });
      showToast(t('error_generic_action'), 'error');
    }
  };

  const handleTagsChange = (session: ArchiveSession, newTags: string[]) =>
    handleFieldUpdate(session, 'tags', newTags);

  const handleTitleChange = (session: ArchiveSession, newTitle: string) =>
    handleFieldUpdate(session, 'title', newTitle);

  const handleDateChange = (session: ArchiveSession, newDate: Date) =>
    handleFieldUpdate(session, 'date', newDate);

  const handleLabelChange = (session: ArchiveSession, labelId: string | undefined) =>
    handleFieldUpdate(session, 'labelId', labelId);

  const activeSessions = sessions.filter(s => !s.trashedAt);
  const trashedSessions = sessions.filter(s => !!s.trashedAt);

  return {
    sessions, activeSessions, trashedSessions, loading, error, cloudLoadFailed, fetchSessions,
    handleDeleteSession, handleTrashSession, handleRestoreSession, handlePermanentDeleteSession, handleEmptyTrash,
    handleTagsChange, handleTitleChange, handleDateChange, handleLabelChange,
    previewSession, setPreviewSession, openPreview,
    deleteConfirm, setDeleteConfirm,
    permanentDeleteConfirm, setPermanentDeleteConfirm,
    emptyTrashConfirm, setEmptyTrashConfirm,
  };
}
