import { describe, it, expect } from 'vitest';
import { classifyProviderFailure } from '../shared/aiUtils';

// Every provider failure used to be re-thrown as HttpsError('internal'), so an
// outage at the model provider looked exactly like a bug in our own request.
// The client could not tell the user anything useful, and could not judge
// whether retrying made sense.
describe('classifyProviderFailure', () => {
  it.each([
    ['OpenRouter 502: Bad gateway', 'UPSTREAM_ERROR'],
    ['OpenRouter 503: upstream overloaded', 'UPSTREAM_ERROR'],
    ['body read timeout', 'UPSTREAM_TIMEOUT'],
    ['fetch failed', 'UPSTREAM_TIMEOUT'],
    ['read ECONNRESET', 'UPSTREAM_TIMEOUT'],
  ])('reports %s as the provider being down', (message, reason) => {
    const out = classifyProviderFailure(new Error(message));
    expect(out).toEqual({ code: 'unavailable', reason });
  });

  it('keeps our own bad request as internal — a 4xx is ours to fix', () => {
    expect(classifyProviderFailure(new Error('OpenRouter 400: invalid model')))
      .toEqual({ code: 'internal', reason: 'BAD_REQUEST' });
  });

  it('reports a missing key as a configuration fault, not an outage', () => {
    expect(classifyProviderFailure(new Error('OPENROUTER_API_KEY not set')))
      .toEqual({ code: 'internal', reason: 'MISCONFIGURED' });
  });

  it('falls back to internal for anything unrecognised', () => {
    expect(classifyProviderFailure(new Error('something else entirely')).code).toBe('internal');
  });
});
