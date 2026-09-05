import { describe, it, expect } from 'vitest';
import { isCiphertext, isSideCiphertext, comparableOrUnknown } from '../comparableOrUnknown';

describe('AG-CIPH-1: isCiphertext and isSideCiphertext heuristic', () => {
  it('does not treat English prose starting with "ey" (e.g. "Eyes...") as ciphertext', () => {
    expect(isCiphertext('Eyes were everywhere.')).toBe(false);
    expect(isCiphertext('Eyewitness accounts confirmed the event.')).toBe(false);
    expect(isCiphertext('eyeball tracking is active')).toBe(false);
  });

  it('correctly treats base64 JSON ("eyJ") and standard encryption prefixes as ciphertext', () => {
    expect(isCiphertext('eyJhbGciOi...')).toBe(true);
    expect(isCiphertext('enc:AES256GCM:somepayload')).toBe(true);
    expect(isCiphertext('jwenc:somepayload')).toBe(true);
  });

  it('isSideCiphertext honors _encrypted flag over content inspection', () => {
    // Flag says encrypted: even with arbitrary content, it is ciphertext
    expect(isSideCiphertext({ content: 'Hello world', _encrypted: true })).toBe(true);

    // Flag says plaintext (e.g. decrypted cloud copy): even if content starts with eyJ or enc:
    expect(isSideCiphertext({ content: 'eyJhbGciOi...', _encrypted: false })).toBe(false);
    expect(isSideCiphertext({ content: 'enc:something', _encrypted: false })).toBe(false);

    // Flag undefined: falls back to prefix heuristic
    expect(isSideCiphertext({ content: 'Eyes were everywhere.' })).toBe(false);
    expect(isSideCiphertext({ content: 'eyJhbGciOi...' })).toBe(true);
  });

  it('allows comparing English prose starting with "ey" between local and cloud', () => {
    const local = { content: 'Eyes were everywhere.', _encrypted: false };
    const cloud = { content: 'Eyes were everywhere.', _encrypted: false };
    const res = comparableOrUnknown(cloud, local);
    expect(res).toEqual({ comparable: true, same: true });
  });
});

describe('AG-SYNC-11: comparableOrUnknown handles missing sides and undefined content', () => {
  it('returns unknown when cloud side is missing or undefined', () => {
    const local = { content: 'Hello', _encrypted: false };
    expect(comparableOrUnknown(null, local)).toEqual({ comparable: false, reason: 'unknown' });
    expect(comparableOrUnknown(undefined, local)).toEqual({ comparable: false, reason: 'unknown' });
  });

  it('returns unknown when local side is missing or undefined', () => {
    const cloud = { content: 'Hello', _encrypted: false };
    expect(comparableOrUnknown(cloud, null)).toEqual({ comparable: false, reason: 'unknown' });
    expect(comparableOrUnknown(cloud, undefined)).toEqual({ comparable: false, reason: 'unknown' });
  });

  it('returns unknown when content is undefined or null on either side', () => {
    const sideA = { content: undefined as unknown as string, _encrypted: false };
    const sideB = { content: 'Hello', _encrypted: false };
    expect(comparableOrUnknown(sideA, sideB)).toEqual({ comparable: false, reason: 'unknown' });
    expect(comparableOrUnknown(sideB, sideA)).toEqual({ comparable: false, reason: 'unknown' });
  });

  it('distinguishes empty string from undefined content', () => {
    const emptyLocal = { content: '', _encrypted: false };
    const emptyCloud = { content: '', _encrypted: false };
    expect(comparableOrUnknown(emptyCloud, emptyLocal)).toEqual({ comparable: true, same: true });

    const nonEmptyLocal = { content: 'Some text', _encrypted: false };
    expect(comparableOrUnknown(emptyCloud, nonEmptyLocal)).toEqual({ comparable: true, same: false });
  });
});

describe('AG-CIPH-2: local version without _encrypted flag inspected for ciphertext', () => {
  it('unflagged local ciphertext compared to decrypted cloud is unknown, not divergent', () => {
    // Decrypted cloud copy has _encrypted: false
    const cloudHead = { content: 'Decrypted plaintext content', _encrypted: false };
    // Local version object has no _encrypted field (LocalVersion type)
    const localVersion = { content: 'enc:AES256GCM:secretCiphertext' };

    const res = comparableOrUnknown(cloudHead, localVersion);
    // Must be unknown because one side is ciphertext and one is plaintext
    expect(res).toEqual({ comparable: false, reason: 'unknown' });
  });

  it('unflagged local base64 JSON ciphertext compared to decrypted cloud is unknown', () => {
    const cloudHead = { content: 'Decrypted plaintext content', _encrypted: false };
    const localVersion = { content: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' };

    const res = comparableOrUnknown(cloudHead, localVersion);
    expect(res).toEqual({ comparable: false, reason: 'unknown' });
  });
});
