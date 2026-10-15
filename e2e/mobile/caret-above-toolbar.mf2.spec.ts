// MF-2: строка, которую печатают, не уходит под панель письма. Отступ снизу у
// поля считался по клавиатуре (120 px без неё) и не знал высоты столбца
// «панель записи + панель письма»; строка каретки пряталась под ним.
import { expect, test, type Page } from '@playwright/test';
import { DICTATION_ENGINE, shot, signInMobile, startDictation, zenOff } from './harness';

const CASES = [
  { tag: '390x844', viewport: { width: 390, height: 844 } },
  { tag: '360x740', viewport: { width: 360, height: 740 } },
];

const LINES = Array.from({ length: 40 }, (_, i) => `строка ${i + 1} проверки каретки`).join('\n');

/** Низ последней строки текста (каретка в конце) минус верх столбца панелей. */
function caretBelowColumn(page: Page): Promise<number> {
  return page.evaluate(() => {
    const ta = document.querySelector('textarea')!;
    const pb = parseFloat(getComputedStyle(ta).paddingBottom);
    const r = ta.getBoundingClientRect();
    const lastLineBottom = r.top + (ta.scrollHeight - pb) - ta.scrollTop;
    const column = document.querySelector('[data-write-column]') ?? document.querySelector('[data-write-toolbar]');
    return Math.round(lastLineBottom - column!.getBoundingClientRect().top);
  });
}

for (const c of CASES) {
  test.describe(`MF-2: каретка над панелью на ${c.tag}`, () => {
    test.use({ viewport: c.viewport });

    test('40 строк — строка каретки выше панели; с открытой диктовкой тоже', async ({ page }) => {
      await page.addInitScript(DICTATION_ENGINE);
      await zenOff(page);
      await signInMobile(page, `mf2-${c.tag}`);
      await page.goto('/');
      const editor = page.locator('textarea').first();
      await editor.waitFor({ state: 'visible', timeout: 30_000 });
      await editor.click();
      await editor.fill(LINES);
      await editor.pressSequentially(' конец', { delay: 5 });
      await page.waitForTimeout(300);
      await shot(page, `mf2-caret-${c.tag}`);
      const below = await caretBelowColumn(page);
      expect(below, `строка каретки на ${below}px ниже верха панели`).toBeLessThanOrEqual(0);

      await startDictation(page);
      await page.waitForTimeout(400);
      await editor.pressSequentially(' ещё', { delay: 5 });
      await page.waitForTimeout(300);
      await shot(page, `mf2-caret-dictation-${c.tag}`);
      const belowRec = await caretBelowColumn(page);
      expect(belowRec, `с диктовкой строка каретки на ${belowRec}px ниже верха панели`).toBeLessThanOrEqual(0);
    });
  });
}
