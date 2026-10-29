// Журнал владельца 29.10: офлайн-чтение профиля легло в журнал красной ERROR
// «Техническая ошибка» с raw "[object Object]". supabase-js при сбое fetch
// отдаёт не Error, а объект { message: 'TypeError: Failed to fetch', … };
// handleDbError делал String(error) до reportError, и reportError не узнавал
// обрыв сети (он его понижает до предупреждения, B-9).
// Мутация: вернуть String(error) для не-Error → красный.
import { describe, it, expect, beforeEach } from 'vitest';
import { handleDbError, OperationType } from '../db-errors';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';

describe('handleDbError: обрыв сети от supabase-js — предупреждение, не ошибка', () => {
  beforeEach(() => useActivityLogStore.setState({ entries: [] }));

  it('объект { message: "TypeError: Failed to fetch" } → warning с текстом, без [object Object]', () => {
    const info = handleDbError({ message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }, OperationType.GET, 'users/u1');
    expect(info.error).toBe('TypeError: Failed to fetch');
    const entry = useActivityLogStore.getState().entries[0];
    expect(entry?.level).toBe('warning');
    expect(JSON.stringify(entry)).not.toContain('[object Object]');
  });
});
