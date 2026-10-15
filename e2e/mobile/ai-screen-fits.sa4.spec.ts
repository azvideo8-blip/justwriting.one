// SA-4: экран ИИ на телефоне был выше окна на 158 px — `h-[100dvh]` внутри main
// с `pt-8`/`px-4`/`pb-safe-nav`. Документ прокручивался: после выбора диалога
// шапка уезжала за верх, а «→» композера — под вкладки.
import { expect, test } from '@playwright/test';
import { fullyInViewport, grantAiConsent, shot, signInMobile, unlockVaultIfAsked } from './harness';

for (const [w, h] of [[390, 844], [360, 640]] as const) {
  test.describe(`SA-4: экран ИИ на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('документ не прокручивается; после диалога из ☰ шапка на месте, «→» над вкладками', async ({ page }) => {
      const acc = await signInMobile(page, `sa4-${w}`);
      grantAiConsent(acc.uid);
      await page.reload();
      await unlockVaultIfAsked(page, acc.password);
      await page.goto('/ai');
      const composer = page.locator('textarea').last();
      await composer.waitFor({ state: 'visible', timeout: 30_000 });

      const fit = () => page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: window.innerHeight, y: window.scrollY }));
      const empty = await fit();
      expect(empty.sh, `документ ${empty.sh} при окне ${empty.ih}`).toBeLessThanOrEqual(empty.ih);
      const capsule = await composer.evaluate(el => Math.round(el.closest('.rounded-2xl')!.getBoundingClientRect().height));
      expect(capsule, `пустой композер ${capsule} px`).toBeLessThanOrEqual(56);
      await shot(page, `sa4-ai-empty-${w}`);

      const text = `СА4-${Date.now().toString(36)}`;
      await composer.fill(text);
      await composer.press('Enter');
      await expect(page.getByText(text).first()).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(3000);

      await page.getByRole('button', { name: 'Диалоги' }).click();
      await page.getByTestId('dialogue-row').first().click();
      await expect(page.getByText(text).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(800);
      const after = await fit();
      expect(after.y, 'документ прокручен после выбора диалога').toBe(0);
      expect(after.sh).toBeLessThanOrEqual(after.ih);
      expect(await fullyInViewport(page.getByRole('button', { name: 'Диалоги' })), '«Диалоги» ушли за край').toBe(true);
      const send = await page.getByRole('button', { name: /Отправить/ }).boundingBox();
      const nav = await page.locator('[data-testid="mobile-bottom-nav"]').boundingBox();
      expect(send && nav && send.y + send.height <= nav.y, `«→» ${JSON.stringify(send)} под вкладками ${JSON.stringify(nav)}`).toBe(true);
      // MF-7/SA-4: под композером нет пустой полосы — он стоит над вкладками.
      const gap = Math.round(nav!.y - (send!.y + send!.height));
      expect(gap, `между «→» и вкладками ${gap}px`).toBeLessThanOrEqual(56);
      await shot(page, `sa4-ai-dialogue-${w}`);
    });
  });
}
