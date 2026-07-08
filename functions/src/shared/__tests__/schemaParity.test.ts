import { describe, it, expect } from 'vitest';

// NOTE: True schema parity cannot be verified directly in unit tests because
// api/chat.ts is an ESM module tailored for Vercel Edge Runtime, while
// chatWithAI.ts is configured for Firebase Cloud Functions.
// Co-importing them in a single unit test runner leads to compilation/runtime errors
// due to conflicting module resolution. The input schema fields and their limits
// should be kept in sync manually.

import { INJECTION_PATTERNS as clientPatterns } from '../../../../src/shared/ai/injectionPatterns';
import { INJECTION_PATTERNS as functionsPatterns } from '../aiUtils';

describe('Injection patterns parity', () => {
  it('has identical injection patterns between client and functions', () => {
    const clientStr = clientPatterns.map(p => ({ source: p.source, flags: p.flags }));
    const functionsStr = functionsPatterns.map(p => ({ source: p.source, flags: p.flags }));
    expect(clientStr).toEqual(functionsStr);
  });
});
