export interface VersionComparisonSide {
  content?: string | null | undefined;
  _encrypted?: boolean | undefined;
  _decryptionError?: boolean | undefined;
  _degraded?: boolean | undefined;
}

export type ComparisonResult =
  | { comparable: false; reason: 'unknown' }
  | { comparable: true; same: boolean };

/**
 * Checks if a string looks like raw ciphertext (e.g. from encryption).
 * Handles 'enc:', base64 JSON 'eyJ' (where 'J' is the non-optional '{'),
 * or standard vault prefixes.
 */
export function isCiphertext(text?: string | null | undefined): boolean {
  if (!text) return false;
  return text.startsWith('enc:') || text.startsWith('eyJ') || text.startsWith('jwenc:');
}

/**
 * Determines if a side is ciphertext based on its _encrypted flag and content.
 * Flagged encrypted sides that did not decrypt are ciphertext regardless of prefix.
 */
export function isSideCiphertext(side?: VersionComparisonSide | null | undefined): boolean {
  if (!side) return false;
  if (side._decryptionError === true) return true;
  if (side._encrypted === true) return true;
  if (side._encrypted === false) return false;
  return isCiphertext(side.content);
}

/**
 * AG-CORRUPT-3 & AG-SYNC-11: Shared predicate for comparing cloud and local versions.
 * An unreadable or absent side is unknown, not different or empty.
 * Refuses to declare divergence when forms mismatch (ciphertext vs plaintext)
 * or when either side has decryption errors, degraded state, or missing content.
 */
export function comparableOrUnknown(
  cloudSide?: VersionComparisonSide | null | undefined,
  localSide?: VersionComparisonSide | null | undefined,
): ComparisonResult {
  if (!cloudSide || !localSide) {
    return { comparable: false, reason: 'unknown' };
  }

  if (
    cloudSide.content === undefined ||
    cloudSide.content === null ||
    localSide.content === undefined ||
    localSide.content === null
  ) {
    return { comparable: false, reason: 'unknown' };
  }

  if (
    cloudSide._decryptionError === true ||
    cloudSide._degraded === true ||
    localSide._decryptionError === true ||
    localSide._degraded === true
  ) {
    return { comparable: false, reason: 'unknown' };
  }

  const cloudIsCiphertext = isSideCiphertext(cloudSide);
  const localIsCiphertext = isSideCiphertext(localSide);

  if (cloudIsCiphertext !== localIsCiphertext) {
    return { comparable: false, reason: 'unknown' };
  }

  return {
    comparable: true,
    same: cloudSide.content === localSide.content,
  };
}
