// 0.11.22: addManual глотал сбой записи, а чат после 👍/👎 говорил «Учту».
// Теперь false — не записано. Мутация: в catch вернуть true — красный.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../core/storage/localDb', async (orig) => ({
  ...(await orig<object>()),
  getLocalDb: vi.fn(async () => { throw new Error('idb down'); }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { AIChatMemoryService } from '../AIChatMemoryService';

describe('AIChatMemoryService.addManual: итог записи', () => {
  it('база не открылась — false, а не молчаливый успех', async () => {
    await expect(AIChatMemoryService.addManual('preference', 'синтетика')).resolves.toBe(false);
  });
});
