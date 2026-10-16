import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { handle as dispatch } from '../dispatcher';

// R7Q-009: гейт AUD-20 («необратимое удаление требует свежего ввода пароля»)
// был написан ровно под один эндпоинт — `deleteAccount`. Админское «Удалить»
// (`adminDeleteUser`) — второе необратимое удаление на сервере, и прямой вызов
// с живым токеном проходил мимо него.
const { adminDeleteUserLogic } = vi.hoisted(() => ({
  adminDeleteUserLogic: vi.fn(async () => ({ success: true })),
}));

vi.mock('../auth', () => ({
  requireSession: vi.fn(async () => ({ uid: 'admin-1', role: 'authenticated', claims: {} })),
  passwordRecentlyVerified: vi.fn(() => false),
}));

vi.mock('../admin/admin.logic', () => ({
  adminDeleteUserLogic,
  inviteUserLogic: vi.fn(async () => ({ success: true })),
  listUsersWithStatusLogic: vi.fn(async () => ({ users: [] })),
}));

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    getAiConsent: vi.fn().mockResolvedValue({ granted: true }),
    getDailyLimitCount: vi.fn().mockResolvedValue({ used: 0, reasoningUsed: 0 }),
    isAdmin: vi.fn().mockResolvedValue(false),
  },
}));

async function postEndpoint(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const server = http.createServer((req, res) => { void dispatch(req, res); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await res.json() as Record<string, unknown>;
    return { status: res.status, json };
  } finally {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
  }
}

describe('R7Q-009: adminDeleteUser требует свежего ввода пароля', () => {
  beforeEach(() => {
    adminDeleteUserLogic.mockClear();
  });

  it('без подтверждённого пароля — 403 REAUTH_REQUIRED и логика не вызвана', async () => {
    const { passwordRecentlyVerified } = await import('../auth');
    (passwordRecentlyVerified as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const res = await postEndpoint('/api/adminDeleteUser', { uid: '22222222-2222-4222-8222-222222222222' });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.json)).toContain('REAUTH_REQUIRED');
    expect(adminDeleteUserLogic).not.toHaveBeenCalled();
  });

  it('свежий ввод проходит дальше (перекрёсток: гейт не глушит эндпоинт совсем)', async () => {
    const { passwordRecentlyVerified } = await import('../auth');
    (passwordRecentlyVerified as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const res = await postEndpoint('/api/adminDeleteUser', { uid: '22222222-2222-4222-8222-222222222222' });

    expect(adminDeleteUserLogic).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});
