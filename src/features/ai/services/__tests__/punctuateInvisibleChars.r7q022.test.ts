import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { punctuateDictation } from '../punctuateDictation';
import { AIService } from '../AIService';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { sameWords, stripFormatControls } from '../../../../shared/ai/sameWords';

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: vi.fn(() => ({ uid: 'u_q22', email: 'nobody-q22@example.invalid' })),
}));
vi.mock('../../../../core/ai/aiConsent', () => ({ getAiConsent: () => true }));
vi.mock('../AIService', () => ({ AIService: { process: vi.fn() } }));

// R7Q-022: «слова не меняются» проверяется по буквам и цифрам, поэтому
// форматирующие символы (zero width space, мягкий перенос, LRM/RLM, BOM) для
// этой проверки невидимы. Ответ, всунувший их ВНУТРЬ слов, проходит гейт и
// вставляется в заметку как есть: человек получает невидимые байты, которые
// потом ломают поиск, diff и счётчик слов.
const RAW = 'сегодня был долгий день и я записал несколько мыслей';
const POISONED = 'сего\u200bdney был\u00ADдолгий\u200e день и я записал\u2060 несколько мыслей';
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/u;

describe('R7Q-022: невидимые символы не попадают в заметку через «расставить знаки»', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(AIService.process).mockReset();
    useAiLimitStore.setState({ used: 0, remaining: 30, limit: 30, headerSyncAt: 0, reconciled: false, limitUnknown: false });
  });

  it('ответ с невидимками на границах слов проходит гейт слов и возвращается дословно', async () => {
    // Ветка `sameWords`: символы вставлены между словом и пробелом, последо-
    // вательность слов та же — проверка «слова не меняются» их не видит.
    const atEdges = 'сегодня был долгий\u200B день и я записал несколько мыслей\uFEFF';
    expect(sameWords(RAW, atEdges), 'предпосылка: гейт слов слеп к невидимкам').toBe(true);
    vi.mocked(AIService.process).mockResolvedValue({ ok: true, text: atEdges });

    const res = await punctuateDictation(RAW, {});

    expect(res.punctuated).toBe(true);
    expect(res.text, `в тексте остались невидимки: ${JSON.stringify(res.text)}`).toBe(RAW);
  });

  it('ответ с невидимками ВНУТРИ слов проходит по ветке переноса пунктуации — и там чищится', async () => {
    // Ветка `transferPunctuation`: слова разбиты мягким переносом, значит
    // sameWords уже false, а покрытие по словам ещё достаточное.
    expect(sameWords(RAW, POISONED), 'предпосылка: слова разъединены').toBe(false);
    vi.mocked(AIService.process).mockResolvedValue({ ok: true, text: POISONED });

    const res = await punctuateDictation(RAW, {});

    expect(INVISIBLE.test(res.text), `в тексте остались невидимки: ${JSON.stringify(res.text)}`).toBe(false);
    expect(res.text.replace(/\s+/g, ' ')).toContain('долгий');
  });

  it('принятый ответ очищен от форматирующих символов, слова целы', async () => {
    vi.mocked(AIService.process).mockResolvedValue({ ok: true, text: POISONED });

    const res = await punctuateDictation(RAW, {});

    expect(INVISIBLE.test(res.text), `в тексте остались невидимки: ${JSON.stringify(res.text)}`).toBe(false);
    expect(res.text).toBe(stripFormatControls(res.text));
  });

  it('обычный ответ (без невидимок) проходит нетронутым', async () => {
    const clean = 'Сегодня был долгий день, и я записал несколько мыслей.';
    vi.mocked(AIService.process).mockResolvedValue({ ok: true, text: clean });

    const res = await punctuateDictation(RAW, {});

    expect(res.text).toBe(clean);
  });
});
