import { useState, useEffect, useRef, useCallback } from 'react';
import { User } from 'firebase/auth';
import { loadAllSessions } from '../../../core/services/UnifiedSessionLoader';
import { ArchiveSession } from '../types';
import { updateArchiveField, deleteArchiveSession } from '../services/archiveCrud';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';
import { logger } from '../../../shared/errors/logger';
import { useToast } from '../../../shared/components/Toast';
import { rebuildWordCloud } from './useArchiveWordCloud';

export function useArchiveSessions(user: User | null, userId: string, t: (key: string) => string) {
  const [sessions, setSessions] = useState<ArchiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloudLoadFailed, setCloudLoadFailed] = useState(false);
  const [previewSession, setPreviewSession] = useState<ArchiveSession | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ArchiveSession | null>(null);
  const mountedRef = useRef(true);
  const isVaultUnlocked = useEncryptionStore(s => s.isVaultUnlocked);
  const prevVaultUnlockedRef = useRef(isVaultUnlocked);
  const { showToast } = useToast();

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await loadAllSessions(userId, user);
      if (!mountedRef.current) return;
      setSessions(result.sessions as ArchiveSession[]);
      setCloudLoadFailed(result.cloudLoadFailed);
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
    void fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    if (isVaultUnlocked && !prevVaultUnlockedRef.current) {
      void fetchSessions();
    }
    prevVaultUnlockedRef.current = isVaultUnlocked;
  }, [isVaultUnlocked, fetchSessions]);

  const updateSession = (id: string, patch: Partial<ArchiveSession>) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    setPreviewSession(prev => prev && prev.id === id ? { ...prev, ...patch } : prev);
  };

  const handleDeleteSession = async (s: ArchiveSession) => {
    try {
      await deleteArchiveSession(s, userId);
      setSessions(prev => prev.filter(x => x.id !== s.id));
      if (previewSession?.id === s.id) setPreviewSession(null);
      void rebuildWordCloud().catch(() => { /* non-critical */ });
    } catch (e) {
      logger.error('archive', 'Failed to delete session', { error: String(e) });
      showToast(t('error_delete_failed'), 'error');
    }
  };

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

  return {
    sessions, loading, error, cloudLoadFailed, fetchSessions,
    handleDeleteSession, handleTagsChange, handleTitleChange, handleDateChange, handleLabelChange,
    previewSession, setPreviewSession,
    deleteConfirm, setDeleteConfirm,
  };
}
