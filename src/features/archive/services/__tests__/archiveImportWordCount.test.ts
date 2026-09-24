import { describe, it, expect } from 'vitest';
import { parseImportFile } from '../archiveImport';
import { countWords } from '../../../../shared/utils/countWords';

// R4-7: импорт считал слова по пробелам, остальное приложение — countWords.
describe('R4-7: imported notes count words like the rest of the app', () => {
  it('uses countWords', () => {
    const text = '你好世界 — это «тест»';
    expect(parseImportFile('n.md', text).wordCount).toBe(countWords(text));
    expect(countWords(text)).not.toBe(text.trim().split(/\s+/).filter(Boolean).length);
  });
});
