// S-30: Fixed phrase corpus for the crisis detector in CI.
// Source: justwriting-docs/crisis-corpus.json (488 phrases, 473 required, 15 knownGap).
//
// Rules:
// 1. New crisis phrasings go into crisisCorpus.json with a source note in `sources`.
// 2. A label change (risk <-> safe) requires the owner's decision (see crisis-corpus-draft-notes.md).
// 3. Known gaps (typos, ambiguous topic mentions without intent) are marked with `knownGap: true`
//    and kept in the file for tracking future improvements.

import { describe, it, expect } from 'vitest';
import { detectRisk } from '../riskDetect';
import corpusData from './crisisCorpus.json';

interface CorpusItem {
  text: string;
  expect: 'risk' | 'safe';
  category: string;
  sources: string[];
  note?: string;
  knownGap?: boolean;
}

const corpus = corpusData as CorpusItem[];
const requiredCases = corpus.filter(c => !c.knownGap);

describe('crisisCorpus (S-30)', () => {
  it('ratchet: corpus size and required count do not regress', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(488);
    expect(requiredCases.length).toBeGreaterThanOrEqual(473);

    // Verify key categories are represented
    const categories = new Set(corpus.map(c => c.category));
    const requiredCategories = [
      'direct-intent',
      'idiom-intent',
      'future-first-person',
      'means',
      'self-harm',
      'negation-before',
      'negation-after',
      'stance-marker',
      'place-companion',
      'method-verb',
      'other-person',
      'invisible',
      'homoglyph',
      'en',
      'translit',
      'goodbye',
      'grief',
      'idiom-fp',
    ];
    for (const cat of requiredCategories) {
      expect(categories.has(cat), `Category "${cat}" must be present in corpus`).toBe(true);
    }
  });

  describe('required corpus cases', () => {
    it.each(requiredCases)('$category: "$text" -> $expect', ({ text, expect: expected, category, sources, note }) => {
      const result = detectRisk(text);
      const isExpected = result.isRisk === (expected === 'risk');
      if (!isExpected) {
        const failureDetails = [
          `Category: ${category}`,
          `Sources: ${sources.join(', ')}`,
          note ? `Note: ${note}` : null,
          `Matched pattern: ${result.matchedPattern ?? 'none'}`,
          `Expected: ${expected}, Got: ${result.isRisk ? 'risk' : 'safe'}`,
        ].filter(Boolean).join(' | ');
        expect(isExpected, `${text} [${failureDetails}]`).toBe(true);
      }
      expect(result.isRisk).toBe(expected === 'risk');
    });
  });

  it('performance: full corpus executes well under 2 seconds', () => {
    const t0 = performance.now();
    for (const item of corpus) {
      detectRisk(item.text);
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(2000);
  });
});
