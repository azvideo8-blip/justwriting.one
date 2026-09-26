import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSessionContent, SessionWithContentFlags } from '../sessionContent';
import { loadSessionContent } from '../UnifiedSessionLoader';
import { LocalVersionService } from '../LocalVersionService';

vi.mock('../UnifiedSessionLoader', () => ({
  loadSessionContent: vi.fn(),
}));

vi.mock('../LocalVersionService', () => ({
  LocalVersionService: {
    getLatestContent: vi.fn(),
  },
}));

describe('SYNC-D4: getSessionContent safe access', () => {
  const userId = 'user_123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns content immediately if already loaded and no error flags', async () => {
    const session: SessionWithContentFlags = {
      id: 's1',
      title: 'Loaded Note',
      content: 'Hello world',
      _contentNotLoaded: false,
    } as any;

    const res = await getSessionContent(session, userId);
    expect(res).toEqual({ ok: true, content: 'Hello world' });
    expect(loadSessionContent).not.toHaveBeenCalled();
    expect(LocalVersionService.getLatestContent).not.toHaveBeenCalled();
  });

  it('refuses when session is marked locked', async () => {
    const session: SessionWithContentFlags = {
      id: 's_locked',
      content: '',
      _locked: true,
    } as any;

    const res = await getSessionContent(session, userId);
    expect(res).toEqual({ ok: false, reason: 'locked' });
  });

  it('refuses when session has decryption error', async () => {
    const session: SessionWithContentFlags = {
      id: 's_dec_err',
      content: '',
      _decryptionError: true,
    } as any;

    const res = await getSessionContent(session, userId);
    expect(res).toEqual({ ok: false, reason: 'decryption_error' });
  });

  it('fetches local version when _contentNotLoaded and _isLocal is true', async () => {
    vi.mocked(LocalVersionService.getLatestContent).mockResolvedValueOnce('Local text recovered');

    const session: SessionWithContentFlags = {
      id: 's_local',
      content: '',
      _isLocal: true,
      _contentNotLoaded: true,
    } as any;

    const res = await getSessionContent(session, userId);
    expect(res).toEqual({ ok: true, content: 'Local text recovered' });
    expect(LocalVersionService.getLatestContent).toHaveBeenCalledWith('s_local', userId);
  });

  it('fetches cloud version when _contentNotLoaded and not local', async () => {
    vi.mocked(loadSessionContent).mockResolvedValueOnce({
      content: 'Cloud text fetched',
      _contentNotLoaded: false,
    });

    const session: SessionWithContentFlags = {
      id: 's_cloud',
      content: '',
      _isLocal: false,
      _contentNotLoaded: true,
    } as any;

    const res = await getSessionContent(session, userId);
    expect(res).toEqual({ ok: true, content: 'Cloud text fetched' });
    expect(loadSessionContent).toHaveBeenCalledWith(userId, 's_cloud');
  });

  it('returns refused when cloud fetch results in locked state', async () => {
    vi.mocked(loadSessionContent).mockResolvedValueOnce({
      content: '',
      _locked: true,
      _contentNotLoaded: false,
    });

    const session: SessionWithContentFlags = {
      id: 's_cloud_locked',
      content: '',
      _isLocal: false,
      _contentNotLoaded: true,
    } as any;

    const res = await getSessionContent(session, userId);
    expect(res).toEqual({ ok: false, reason: 'locked' });
  });

  it('returns error when userId is missing for cloud note', async () => {
    const session: SessionWithContentFlags = {
      id: 's_cloud_no_user',
      content: '',
      _isLocal: false,
      _contentNotLoaded: true,
    } as any;

    const res = await getSessionContent(session, undefined);
    expect(res).toEqual({ ok: false, reason: 'error' });
  });
});
