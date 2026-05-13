import { useState, useEffect, useRef, useCallback } from 'react';
import { User } from 'firebase/auth';
import { loadAllSessions } from '../../writing/services/UnifiedSessionLoader';
import { ArchiveSession } from '../types';
import { updateArchiveField, deleteArchiveSession } from '../services/archiveCrud';

export function useArchiveSessions(user: User | null, userId: string, t: (key: string) => string) {
  const [sessions, setSessions] = useState<ArchiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloudLoadFailed, setCloudLoadFailed] = useState(false);
  const [previewSession, setPreviewSession] = useState<ArchiveSession | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ArchiveSession | null>(null);
  const mountedRef = useRef(true);

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
      console.error('Archive load error:', err);
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
    fetchSessions();
  }, [fetchSessions]);

  const updateSession = (id: string, patch: Partial<ArchiveSession>) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    setPreviewSession(prev => prev && prev.id === id ? { ...prev, ...patch } : prev);
  };

  const handleDeleteSession = async (s: ArchiveSession) => {
    try {
      await deleteArchiveSession(s, userId);
      setSessions(prev => prev.filter(x => x.id !== s.id));
      if (previewSession?.id === s.id) setPreviewSession(null);
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  };

  const handleFieldUpdate = async (
    session: ArchiveSession,
    field: 'tags' | 'title' | 'date' | 'labelId',
    value: string[] | string | Date | undefined
  ) => {
    try {
      await updateArchiveField(session, field, value, user, userId);
      const patch: Partial<ArchiveSession> = {};
      if (field === 'tags') patch.tags = value as string[];
      else if (field === 'title') patch.title = value as string;
      else if (field === 'date') {
        patch.createdAt = value as Date;
        patch.sessionStartTime = (value as Date).getTime();
      } else if (field === 'labelId') patch.labelId = value as string | undefined;
      updateSession(session.id, patch);
    } catch (e) {
      console.error(`Failed to update ${field}:`, e);
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
