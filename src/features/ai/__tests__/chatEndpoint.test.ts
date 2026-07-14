import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import handler from '../../../../api/chat';

const mockAuth = {
  verifyIdToken: vi.fn(),
};
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => mockAuth,
}));

const mockAppCheck = {
  verifyToken: vi.fn(),
};
vi.mock('firebase-admin/app-check', () => ({
  getAppCheck: () => mockAppCheck,
}));

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  getApps: vi.fn(() => [{}]),
  cert: vi.fn(),
  applicationDefault: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn(),
    doc: vi.fn(),
    runTransaction: vi.fn(),
  })),
  FieldValue: {
    increment: vi.fn(),
    serverTimestamp: vi.fn(),
  },
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({
    chat: vi.fn(),
  })),
}));

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

describe('/api/chat endpoint App Check & Auth enforcement', () => {
  let req: any;
  let res: any;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    
    req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-id-token',
      },
      body: {},
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      write: vi.fn().mockReturnThis(),
    };

    // Default mock behavior: auth succeeds
    mockAuth.verifyIdToken.mockResolvedValue({ uid: 'test-user-uid' });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('rejects non-POST requests with 405', async () => {
    req.method = 'GET';
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects unauthenticated requests with 401', async () => {
    req.headers.authorization = undefined;
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('rejects invalid authorization bearer scheme with 401', async () => {
    req.headers.authorization = 'Basic token';
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects requests when auth token verification fails', async () => {
    mockAuth.verifyIdToken.mockRejectedValue(new Error('Invalid token'));
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  describe('with APP_CHECK_ENFORCE=false (default)', () => {
    beforeEach(() => {
      process.env.APP_CHECK_ENFORCE = 'false';
    });

    it('proceeds past App Check verification even if header is missing', async () => {
      // We expect it to try to parse req.body and return 400 Bad Request instead of 401 App Check error
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Bad Request' });
    });
  });

  describe('with APP_CHECK_ENFORCE=true', () => {
    beforeEach(() => {
      process.env.APP_CHECK_ENFORCE = 'true';
    });

    it('rejects with 401 when x-firebase-appcheck header is missing', async () => {
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: App Check token required' });
    });

    it('rejects with 401 when App Check token is invalid', async () => {
      req.headers['x-firebase-appcheck'] = 'invalid-appcheck-token';
      mockAppCheck.verifyToken.mockRejectedValue(new Error('Invalid App Check Token'));

      await handler(req, res);
      expect(mockAppCheck.verifyToken).toHaveBeenCalledWith('invalid-appcheck-token');
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Invalid App Check token' });
    });

    it('proceeds past App Check to body validation when App Check token is valid', async () => {
      req.headers['x-firebase-appcheck'] = 'valid-appcheck-token';
      mockAppCheck.verifyToken.mockResolvedValue({ alreadyConsumed: false });

      await handler(req, res);
      expect(mockAppCheck.verifyToken).toHaveBeenCalledWith('valid-appcheck-token');
      // Should fail at request body validation (400 Bad Request) rather than App Check (401)
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Bad Request' });
    });
  });
});
