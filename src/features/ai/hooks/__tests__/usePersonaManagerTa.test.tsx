// Транзактный аналитик — за флагом chat_persona_ta: без «да» от флага его нет в списке собеседников.
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ value: false }));
vi.mock('../../../../core/sync/syncFlags', () => ({ chatPersonaTaEnabled: vi.fn(async () => flag.value) }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_ta' }) }));

import { usePersonaManager } from '../usePersonaManager';

beforeEach(() => { flag.value = false; });

describe('usePersonaManager: транзактный аналитик за флагом', () => {
  it('флаг выключен — в списке его нет, остальные встроенные на месте', async () => {
    const { result } = renderHook(() => usePersonaManager());
    await new Promise(r => setTimeout(r, 20));
    const ids = result.current.allPersonas.map(p => p.id);
    expect(ids).not.toContain('ta');
    expect(ids).toEqual(expect.arrayContaining(['group_psychology', 'cbt', 'coach', 'editor']));
  });

  it('флаг включён — собеседник в списке', async () => {
    flag.value = true;
    const { result } = renderHook(() => usePersonaManager());
    await waitFor(() => expect(result.current.allPersonas.map(p => p.id)).toContain('ta'));
  });
});
