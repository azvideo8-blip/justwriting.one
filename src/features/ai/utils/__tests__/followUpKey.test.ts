import { describe, it, expect } from 'vitest';
import { followUpKey } from '../followUpKey';
import type { DialogueMessage } from '../../../../core/storage/localDb';

const q: DialogueMessage = { id: 'u1', role: 'user', content: 'тяжёлый день' };
const a: DialogueMessage = { id: 'a1', role: 'assistant', content: 'Слышу, день был тяжёлым.' };

describe('followUpKey — подсказки один раз на ответ', () => {
  it('тот же ответ — тот же ключ, что бы ни менялось вокруг (id диалога, служебные поля, сохранение)', () => {
    const before = followUpKey([q, a]).key;
    const after = followUpKey([{ ...q, createdAt: 1 }, { ...a, createdAt: 2, turnId: 'u1' }]).key;
    expect(after).toBe(before);
  });

  it('новый ответ и перегенерация — новый ключ', () => {
    const k1 = followUpKey([q, a]).key;
    const a2: DialogueMessage = { id: 'a2', role: 'assistant', content: 'Другой ответ' };
    expect(followUpKey([q, a, { id: 'u2', role: 'user', content: 'ещё' }, a2]).key).not.toBe(k1);
    expect(followUpKey([q, { ...a, variantIndex: 1, content: 'Перегенерированный ответ' }]).key).not.toBe(k1);
  });

  it('служебные реплики и пустой диалог подсказок не просят', () => {
    expect(followUpKey([]).lastAssistant).toBeNull();
    expect(followUpKey([q, { role: 'assistant', content: 'итог', type: 'system' }]).lastAssistant).toBeNull();
  });
});
