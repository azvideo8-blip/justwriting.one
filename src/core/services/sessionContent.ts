import { Session } from '../../types';
import { loadSessionContent } from './UnifiedSessionLoader';
import { LocalVersionService } from './LocalVersionService';
import { reportError } from '../../shared/errors/reportError';

export type SessionWithContentFlags = Session & {
  _isLocal?: boolean | undefined;
  _contentNotLoaded?: boolean | undefined;
  _locked?: boolean | undefined;
  _decryptionError?: boolean | undefined;
  _contentError?: boolean | undefined;
  _linkedCloudId?: string | undefined;
};

export type SessionContentResult =
  | { ok: true; content: string }
  | { ok: false; reason: 'locked' | 'decryption_error' | 'error' | 'not_found' };

/**
 * Safely accesses or loads the content of a session.
 * If the session's content is already loaded (!session._contentNotLoaded), returns it.
 * If _contentNotLoaded is true, fetches the text from local storage or cloud VersionService.
 * Never treats an unfetched note as an empty string.
 */
export async function getSessionContent(
  session: SessionWithContentFlags,
  userId?: string
): Promise<SessionContentResult> {
  if (session._locked) {
    return { ok: false, reason: 'locked' };
  }
  if (session._decryptionError) {
    return { ok: false, reason: 'decryption_error' };
  }
  if (session._contentError) {
    return { ok: false, reason: 'error' };
  }

  // If content is already present and marked loaded, return it
  if (!session._contentNotLoaded && typeof session.content === 'string') {
    return { ok: true, content: session.content };
  }

  // Unfetched local note: fetch from local versions
  if (session._isLocal) {
    try {
      const content = await LocalVersionService.getLatestContent(session.id);
      if (content === null && (session.wordCount || 0) > 0) {
        return { ok: false, reason: 'error' };
      }
      return { ok: true, content: content || '' };
    } catch (e) {
      reportError(e, { action: 'getSessionContent_local', id: session.id });
      return { ok: false, reason: 'error' };
    }
  }

  // Unfetched cloud note
  if (!userId) {
    return { ok: false, reason: 'error' };
  }

  const cloudId = session._linkedCloudId || session.id;
  try {
    const flags = await loadSessionContent(userId, cloudId);
    if (flags._locked) return { ok: false, reason: 'locked' };
    if (flags._decryptionError) return { ok: false, reason: 'decryption_error' };
    if (flags._contentError) return { ok: false, reason: 'error' };

    return { ok: true, content: flags.content };
  } catch (e) {
    reportError(e, { action: 'getSessionContent_cloud', id: cloudId });
    return { ok: false, reason: 'error' };
  }
}
