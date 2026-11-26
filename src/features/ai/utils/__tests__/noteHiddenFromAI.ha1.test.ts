// HA-1/HA-2: сбой чтения строки — «скрыта» (fail-closed); нет id — несохранённый текст.
// Мутация: в catch вернуть false — красный.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../core/storage/localDb', () => ({ getLocalDb: async () => { throw new Error('база не открылась'); } }));

import { noteHiddenFromAI } from '../isExcludedFromAI';

describe('noteHiddenFromAI', () => {
  it('база не прочиталась — скрыта', async () => {
    expect(await noteHiddenFromAI('doc_1')).toBe(true);
  });

  it('нет id — новый текст, скрывать нечего', async () => {
    expect(await noteHiddenFromAI(undefined)).toBe(false);
    expect(await noteHiddenFromAI(null)).toBe(false);
  });
});
