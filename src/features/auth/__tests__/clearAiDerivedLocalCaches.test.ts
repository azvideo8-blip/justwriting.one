import { describe, it, expect } from 'vitest';
import { clearAiDerivedLocalCaches } from '../services/accountScopedKeys';
import { portraitCacheKey } from '../../ai/services/AIProfileService';

// N-2: после «Удалить все данные ИИ» портрет не должен вернуться из кэша.
describe('clearAiDerivedLocalCaches', () => {
  it('drops the cached portrait and AI caches of this account only', () => {
    localStorage.setItem(portraitCacheKey('u1'), 'портрет');
    localStorage.setItem('ai_taxonomy_u1', '[]');
    localStorage.setItem(portraitCacheKey('u2'), 'чужой');
    localStorage.setItem('ai_indexing_consent_u1', '1'); // согласие — не производная, остаётся
    clearAiDerivedLocalCaches('u1');
    expect(localStorage.getItem(portraitCacheKey('u1'))).toBeNull();
    expect(localStorage.getItem('ai_taxonomy_u1')).toBeNull();
    expect(localStorage.getItem(portraitCacheKey('u2'))).toBe('чужой');
    expect(localStorage.getItem('ai_indexing_consent_u1')).toBe('1');
  });
});
