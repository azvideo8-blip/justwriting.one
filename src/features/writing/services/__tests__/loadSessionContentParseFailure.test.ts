import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSessionContent } from '../UnifiedSessionLoader';
import { VersionService } from '../../../../core/services/VersionService';

// AUD-5: getLatestVersion возвращал null и на «версии нет», и на «запись не
// прошла валидацию» — второе читалось как пустая заметка без флага, и экспорт
// писал пустой файл как успех. Теперь PARSE_FAILED превращается в _contentError.
describe('loadSessionContent — нечитаемая версия ≠ пустая заметка', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("getLatestVersion === 'PARSE_FAILED' → _contentError, а не пустой успех", async () => {
    vi.spyOn(VersionService, 'getLatestVersion').mockResolvedValue('PARSE_FAILED');

    const flags = await loadSessionContent('user_1', 'cloud_1');

    expect(flags._contentError).toBe(true);
    expect(flags._contentNotLoaded).toBe(false);
    expect(flags._decryptionError).toBeUndefined();
    expect(flags._locked).toBeUndefined();
  });

  it('версии нет (null) → чисто пустой результат без флагов ошибки', async () => {
    vi.spyOn(VersionService, 'getLatestVersion').mockResolvedValue(null);

    const flags = await loadSessionContent('user_1', 'cloud_1');

    expect(flags._contentError).toBeUndefined();
    expect(flags._decryptionError).toBeUndefined();
    expect(flags.content).toBe('');
  });

  it('нормальная версия расшифровывается в текст', async () => {
    vi.spyOn(VersionService, 'getLatestVersion').mockResolvedValue({
      id: 'v3', documentId: 'cloud_1', userId: 'user_1', version: 3,
      content: 'текст заметки', wordCount: 2, wordsAdded: 0, charsAdded: 0,
      duration: 0, wpm: 0, goalReached: false, savedAt: new Date(), sessionStartedAt: new Date(),
    } as never);

    const flags = await loadSessionContent('user_1', 'cloud_1');
    expect(flags.content).toBe('текст заметки');
    expect(flags._contentError).toBeUndefined();
  });
});
