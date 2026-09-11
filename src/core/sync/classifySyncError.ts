/**
 * # Sync Error Classification Rules
 *
 * | Code                     | Poison | Revivable on Unlock | Category             |
 * |--------------------------|--------|---------------------|----------------------|
 * | LOCKED                   | true   | true                | blocked-until-unlock |
 * | ENCRYPT_REQUIRED         | true   | true                | blocked-until-unlock |
 * | DECRYPT_FAILED_LATEST    | true   | true                | blocked-until-unlock |
 * | DECRYPTION_ERROR         | true   | false               | permanent            |
 * | Invalid sessionStartedAt | true   | false               | permanent            |
 * | Document too large       | true   | false               | permanent            |
 * | DUPLICATE_UUID_COLLISION | true   | false               | permanent            |
 * | Cloud document not found | true   | false               | permanent            |
 * | EMPTY_CLOUD_DOCUMENT     | true   | false               | permanent            |
 * | 23514                    | true   | false               | permanent            |
 * | 22001                    | true   | false               | permanent            |
 * | 22P02                    | true   | false               | permanent            |
 * | SYNC_UNRESOLVED          | false  | true                | transient            |
 *
 * NOTE: The server returns some of these as `{ code: '...' }` (or `{ error: { code: '...' } }`)
 * and some in `error.message`. Matching against both `error.code` and `error.message` (as well
 * as stringified errors) is load-bearing.
 *
 * Matching uses word boundaries so substring false-positives (e.g. `UNLOCKED` vs `LOCKED`)
 * are prevented.
 */

export type SyncErrorCategory = 'transient' | 'permanent' | 'blocked-until-unlock';

export interface SyncErrorRule {
  readonly code: string;
  readonly poison: boolean;
  readonly revivableOnUnlock: boolean;
  readonly category: SyncErrorCategory;
}

export const SYNC_ERROR_RULES: readonly SyncErrorRule[] = [
  { code: 'LOCKED',                 poison: true,  revivableOnUnlock: true,  category: 'blocked-until-unlock' },
  { code: 'ENCRYPT_REQUIRED',       poison: true,  revivableOnUnlock: true,  category: 'blocked-until-unlock' },
  { code: 'DECRYPT_FAILED_LATEST',  poison: true,  revivableOnUnlock: true,  category: 'blocked-until-unlock' },
  { code: 'DECRYPTION_ERROR',       poison: true,  revivableOnUnlock: false, category: 'permanent' },
  { code: 'Invalid sessionStartedAt', poison: true, revivableOnUnlock: false, category: 'permanent' },
  { code: 'Document too large',     poison: true,  revivableOnUnlock: false, category: 'permanent' },
  { code: 'DUPLICATE_UUID_COLLISION', poison: true, revivableOnUnlock: false, category: 'permanent' },
  { code: 'Cloud document not found', poison: true, revivableOnUnlock: false, category: 'permanent' },
  { code: 'EMPTY_CLOUD_DOCUMENT',   poison: true,  revivableOnUnlock: false, category: 'permanent' },
  { code: '23514',                  poison: true,  revivableOnUnlock: false, category: 'permanent' },
  { code: '22001',                  poison: true,  revivableOnUnlock: false, category: 'permanent' },
  { code: '22P02',                  poison: true,  revivableOnUnlock: false, category: 'permanent' },
  { code: 'SYNC_UNRESOLVED',        poison: false, revivableOnUnlock: true,  category: 'transient' },
];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMPILED_RULES = SYNC_ERROR_RULES.map(rule => ({
  rule,
  regex: new RegExp(`(?:^|[^a-zA-Z0-9_])${escapeRegex(rule.code)}(?:[^a-zA-Z0-9_]|$)`, 'i'),
}));

function extractErrorTexts(error: unknown): string[] {
  if (error == null) return [];
  const texts: string[] = [];
  if (typeof error === 'string') {
    texts.push(error);
  } else if (typeof error === 'object') {
    const errObj = error as Record<string, unknown>;
    if (typeof errObj.message === 'string') {
      texts.push(errObj.message);
    }
    if (typeof errObj.code === 'string') {
      texts.push(errObj.code);
    }
    if (errObj.error && typeof errObj.error === 'object') {
      const nested = errObj.error as Record<string, unknown>;
      if (typeof nested.message === 'string') texts.push(nested.message);
      if (typeof nested.code === 'string') texts.push(nested.code);
    }
    if (texts.length === 0) {
      texts.push(String(error));
    }
  } else {
    texts.push(String(error));
  }
  return texts;
}

export function matchRule(error: unknown): SyncErrorRule | undefined {
  if (error == null) return undefined;
  const texts = extractErrorTexts(error);
  for (const { rule, regex } of COMPILED_RULES) {
    for (const text of texts) {
      if (regex.test(text)) {
        return rule;
      }
    }
  }
  return undefined;
}

/**
 * Checks if an error is a poison pill that should quarantine the task
 * immediately on the very first attempt without exhausting MAX_ATTEMPTS.
 */
export function isPoisonSyncError(error: unknown): boolean {
  return matchRule(error)?.poison ?? false;
}

/**
 * Checks if a dead / quarantined task can be revived when the vault is unlocked.
 */
export function isRevivableOnUnlock(error: unknown): boolean {
  return matchRule(error)?.revivableOnUnlock ?? false;
}

function fallbackCategory(_error: unknown): SyncErrorCategory {
  return 'transient';
}

/**
 * DUP-4 / FU-2 / FU-6: Single source of truth for sync error classification.
 */
export function classifySyncError(error: unknown): SyncErrorCategory {
  return matchRule(error)?.category ?? fallbackCategory(error);
}
