import { describe, expect, it } from 'vitest';
import { diffPostAgainstNote } from '../editorDiff';
import { SYNTH } from './synthEditorPosts.ed2';

// LD-1, бюджет ложных срабатываний: то же самое множество из 20 постов, что и у
// ED-2. Предупреждение о чужой истории обязано молчать везде, где пост не
// упоминает клиентов, пациентов, сессии и терапию.

describe('LD-1 бюджет: предупреждение о чужой истории по 20 постам', () => {
  it('срабатывает ровно на постах, где клиента называют вслух', () => {
    const hits = SYNTH
      .map(([post, source], i) => ({ i, post, hit: diffPostAgainstNote(post, source).clientStoryInPost }))
      .filter(r => r.hit);
    console.log('LD1_BUDGET', JSON.stringify(hits, null, 2));
    // Из 20 постов про клиента говорит один — это не ложное срабатывание, а
    // ровно тот случай, ради которого правило заведено.
    expect(hits.map(h => h.i)).toEqual([18]);
    expect(hits[0]?.post).toContain('клиент');
  });
});
