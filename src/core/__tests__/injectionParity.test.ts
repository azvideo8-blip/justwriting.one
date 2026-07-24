import { describe, it, expect } from 'vitest';
import { INJECTION_PATTERNS as clientPatterns } from '../../shared/ai/injectionPatterns';
import { INJECTION_PATTERNS as functionPatterns } from '../../../functions/src/shared/aiUtils';

describe('SEC-52 Injection Pattern Parity', () => {
  it('asserts that client and Cloud Functions injection pattern lists are identical', () => {
    const clientSource = clientPatterns.map(p => p.source).sort();
    const functionSource = functionPatterns.map(p => p.source).sort();

    expect(clientSource).toEqual(functionSource);
  });
});
