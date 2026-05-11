import { useState, useEffect, useRef, useCallback } from 'react';
import { User } from 'firebase/auth';
import { StorageService } from '../../writing/services/StorageService';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { DocumentService } from '../../writing/services/DocumentService';
import { SessionService } from '../../writing/services/SessionService';
import { loadAllSessions } from '../../writing/services/UnifiedSessionLoader';
import { ArchiveSession } from '../types';

export function useArchiveSessions(user: User | null, userId: string, t: (key: string) => string) {
  const [sessions, setSessions] = useState<ArchiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloudLoadFailed, setCloudLoadFailed] = useState(false);
  const [previewSession, setPreviewSession] = useState<ArchiveSession | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ArchiveSession | null>(null);
  const mountedRef = useRef(true);

  const fetchSessions = useCallback(async (_retry = false) => {
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
      if (s._isLegacy) {
        await SessionService.deleteSession(s.id);
      } else {
        await StorageService.deleteDocument(
          userId,
          s._isLocal ? s.id : undefined,
          s._hasCloudCopy ? (s._linkedCloudId || s.id) : undefined
        );
      }
      setSessions(prev => prev.filter(x => x.id !== s.id));
      if (previewSession?.id === s.id) setPreviewSession(null);
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  };

  const handleTagsChange = async (session: ArchiveSession, newTags: string[]) => {
    try {
      if (session._isLegacy) {
        await SessionService.updateSession(session.id, { tags: newTags });
      } else if (session._isLocal) {
        await LocalDocumentService.updateTags(session.id, newTags);
        if (session._linkedCloudId && user) {
          await DocumentService.updateTags(user.uid, session._linkedCloudId, newTags).catch(() => {});
        }
      } else if (user) {
        await DocumentService.updateTags(user.uid, session.id, newTags);
      }
      updateSession(session.id, { tags: newTags });
    } catch (e) {
      console.error('Failed to update tags:', e);
    }
  };

  const handleTitleChange = async (session: ArchiveSession, newTitle: string) => {
    try {
      if (session._isLegacy) {
        await SessionService.updateSession(session.id, { title: newTitle });
      } else if (session._isLocal) {
        await LocalDocumentService.updateTitle(session.id, newTitle);
        if (session._linkedCloudId && user) {
          await DocumentService.updateTitle(user.uid, session._linkedCloudId, newTitle).catch(() => {});
        }
      } else if (user) {
        await DocumentService.updateTitle(user.uid, session.id, newTitle);
      }
      updateSession(session.id, { title: newTitle });
    } catch (e) {
      console.error('Failed to update title:', e);
    }
  };

  const handleDateChange = async (session: ArchiveSession, newDate: Date) => {
    try {
      const ts = newDate.getTime();
      if (session._isLegacy) {
        await SessionService.updateSession(session.id, { sessionStartTime: ts });
      } else if (session._isLocal) {
        await LocalDocumentService.updateDate(session.id, ts, ts);
        if (session._linkedCloudId && user) {
          await DocumentService.updateDate(user.uid, session._linkedCloudId, newDate, newDate).catch(() => {});
        }
      } else if (user) {
        await DocumentService.updateDate(user.uid, session.id, newDate, newDate);
      }
      updateSession(session.id, { createdAt: newDate, sessionStartTime: ts });
    } catch (e) {
      console.error('Failed to update date:', e);
    }
  };

  const handleLabelChange = async (session: ArchiveSession, labelId: string | undefined) => {
    try {
      if (session._isLegacy) {
        await SessionService.updateSession(session.id, { labelId });
      } else if (session._isLocal) {
        await LocalDocumentService.updateLabelId(session.id, labelId);
        if (session._linkedCloudId && user) {
          await DocumentService.updateLabelId(user.uid, session._linkedCloudId, labelId).catch(() => {});
        }
      } else if (user) {
        await DocumentService.updateLabelId(user.uid, session.id, labelId);
      }
      updateSession(session.id, { labelId });
    } catch (e) {
      console.error('Failed to update label:', e);
    }
  };

  return {
    sessions, loading, error, cloudLoadFailed, fetchSessions,
    handleDeleteSession, handleTagsChange, handleTitleChange, handleDateChange, handleLabelChange,
    previewSession, setPreviewSession,
    deleteConfirm, setDeleteConfirm,
  };
}
