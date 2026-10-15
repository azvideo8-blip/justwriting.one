// MF-3: одна спокойная панель письма — чип (режим · время · слова), микрофон и
// «Сохранить». При идущей сессии строка влезает в 320/360/390 без
// горизонтальной прокрутки, а числа в чипе не обрезаны. Пауза, «Новая заметка»
// и ИИ-помощник — строки листа, который открывает чип.
import { expect, test } from '@playwright/test';
import { DICTATION_ENGINE, shot, signInMobile, zenOff } from './harness';

const WORDS = Array.from({ length: 120 }, (_, i) => `слово${i}`).join(' ');

for (const [w, h] of [[320, 568], [360, 740], [390, 844]] as const) {
  test.describe(`MF-3: панель письма на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('идёт сессия, 120 слов — панель в экране, числа видны; лист даёт паузу, новую заметку и ИИ', async ({ page }) => {
      await zenOff(page);
      await page.addInitScript(DICTATION_ENGINE);
      await signInMobile(page, `mf3-${w}`);
      await page.goto('/');
      const editor = page.locator('textarea').first();
      await editor.waitFor({ state: 'visible', timeout: 30_000 });
      await editor.click();
      await editor.fill(WORDS);
      await editor.pressSequentially(' ещё', { delay: 5 });

      const toolbar = page.locator('[data-write-toolbar]');
      const chip = toolbar.locator('[data-write-chip]');
      await expect(chip).toContainText(/121 сл/, { timeout: 10_000 });
      await shot(page, `mf3-toolbar-running-${w}`);

      const geo = await page.evaluate(() => {
        const tb = document.querySelector('[data-write-toolbar]')!.getBoundingClientRect();
        const c = document.querySelector<HTMLElement>('[data-write-chip]')!;
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          toolbarRight: Math.round(tb.right),
          chipOverflow: c.scrollWidth - c.clientWidth,
        };
      });
      expect(geo.scrollWidth, `горизонтальная прокрутка: ${geo.scrollWidth} > ${geo.innerWidth}`).toBeLessThanOrEqual(geo.innerWidth + 1);
      expect(geo.toolbarRight, 'панель за правым краем').toBeLessThanOrEqual(geo.innerWidth);
      expect(geo.chipOverflow, `числа в чипе вылезают на ${geo.chipOverflow}px`).toBeLessThanOrEqual(1);
      expect(await toolbar.locator('button').count(), 'в панели не три цели').toBe(3);

      // Лист сессии: пауза → чип говорит «На паузе» (MQ-14).
      await chip.click();
      await page.getByRole('button', { name: /^Пауза$/ }).click();
      await expect(chip).toContainText(/На паузе/, { timeout: 5_000 });
      // ИИ-помощник открывает ту же панель ИИ, что раньше ✦.
      await chip.click();
      await expect(page.getByRole('button', { name: /^Новая заметка$/ })).toBeVisible();
      await page.getByRole('button', { name: /ИИ-помощник/ }).click();
      await expect(page.getByRole('dialog', { name: 'ИИ-помощник' })).toBeVisible({ timeout: 5_000 });
      await shot(page, `mf3-ai-panel-${w}`);
    });
  });
}
