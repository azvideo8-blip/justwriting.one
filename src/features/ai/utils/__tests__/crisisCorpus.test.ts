// S-30: Fixed phrase corpus for the crisis detector in CI.
// Source: justwriting-docs/crisis-corpus.json (866 фраз, 840 обязательных, 26 knownGap) — the two copies stay byte-identical (S-42.1).
//
// Rules:
// 1. New crisis phrasings go into crisisCorpus.json with a source note in `sources`.
// 2. A label change (risk <-> safe) requires the owner's decision (see crisis-corpus-draft-notes.md).
// 3. Known gaps (typos, ambiguous topic mentions without intent) are marked with `knownGap: true`
//    and kept in the file for tracking future improvements.

import { describe, it, expect } from 'vitest';
import { detectRisk } from '../riskDetect';
import { classifyInvisibleCodePoint } from '../../../../shared/ai/buildChatPrompt';
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

// S-42.4: невидимые символы в имени теста — escape-последовательностью, а не сырым кодом.
function visible(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const invisible = cp < 0x20 || (cp >= 0x0300 && cp <= 0x036F) || classifyInvisibleCodePoint(cp) !== 'keep';
    out += invisible ? `\\u{${cp.toString(16).toUpperCase()}}` : ch;
  }
  return out;
}

describe('crisisCorpus (S-30)', () => {
  it('ratchet: corpus size and required count do not regress', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(866);
    expect(requiredCases.length).toBeGreaterThanOrEqual(840);
    // S-42.5: точные счётчики по меткам — перекрашенная фраза видна в диффе теста, а не проглочена ратчетом.
    // C-2: +41 пункт корпуса из backlog «Crisis detector (2026-10-02)» (19 регрессий,
    // 6 открытых пропусков, 15 ложных срабатываний, 1 пин для мутации).
    // T-10: +11 safe everyday (ложные срабатывания новых сильных паттернов T-7).
    const labels = { risk: 0, safe: 0 };
    for (const c of requiredCases) labels[c.expect]++;
    expect(labels).toEqual({ risk: 507, safe: 333 });

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
      // S-50: обычные дневниковые фразы со словами умереть/убить/сдохнуть/покончить/… в бытовом смысле.
      'everyday',
    ];
    for (const cat of requiredCategories) {
      expect(categories.has(cat), `Category "${cat}" must be present in corpus`).toBe(true);
    }
  });

  describe('required corpus cases', () => {
    it.each(requiredCases.map(c => ({ ...c, name: visible(c.text) })))('$category: "$name" -> $expect', ({ text, expect: expected, category, sources, note }) => {
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

  // S-42.4: одна сводка по категориям — видно, какой пласт поехал, а не десятки одинаковых падений.
  it('per-category failure summary', () => {
    const failed = new Map<string, string[]>();
    for (const c of requiredCases) {
      const r = detectRisk(c.text);
      if (r.isRisk === (c.expect === 'risk')) continue;
      const list = failed.get(c.category) ?? [];
      list.push(`"${visible(c.text)}" -> expected ${c.expect}, got ${r.isRisk ? 'risk' : 'safe'} (${r.matchedPattern ?? 'none'})`);
      failed.set(c.category, list);
    }
    const summary = [...failed].map(([cat, items]) => `${cat}: ${items.length} failed\n  ${items.join('\n  ')}`).join('\n');
    expect(summary, `\n${summary}`).toBe('');
  });

  // S-50: медиана трёх прогонов — одиночный замер на загруженной машине давал 1,9 с при бюджете 2 с.
  it('performance: full corpus executes well under 2 seconds (median of 3 runs)', () => {
    const runs: number[] = [];
    for (let r = 0; r < 3; r++) {
      const t0 = performance.now();
      for (const item of corpus) {
        detectRisk(item.text);
      }
      runs.push(performance.now() - t0);
    }
    runs.sort((a, b) => a - b);
    expect(runs[1]!).toBeLessThan(2000);
  });
});
