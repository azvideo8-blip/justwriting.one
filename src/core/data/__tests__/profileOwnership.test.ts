import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
const row = { current: null as Record<string, unknown> | null };
vi.mock('../../supabase/client', () => ({
  getSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row.current, error: null }) }) }) }),
  }),
}));
import { subscribeToProfile } from '../providers/profiles';

const next = (uid: string) => new Promise<unknown>(res => { subscribeToProfile(uid, res); });

// N-31: профиль при входе приходит отсюда, а не из getProfile. Чужая строка
// (сломанный RLS, подменённый ответ) включала бы этому аккаунту сейф и согласие на ИИ.
describe('subscribeToProfile keeps only the own row', () => {
  it('a row of another account is not delivered', async () => {
    row.current = { uid: 'other', ai_consent_at: '2026-01-01T00:00:00Z', encryption_meta: { v: 2 } };
    expect(await next('me')).toBeNull();
  });

  it('the own row is delivered', async () => {
    row.current = { uid: 'me', nickname: 'n' };
    expect(await next('me')).toEqual(expect.objectContaining({ uid: 'me' }));
  });
});
