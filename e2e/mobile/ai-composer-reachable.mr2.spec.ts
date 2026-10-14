// MR-2: композер ИИ на телефоне достижим обычным тапом и не уезжает под панель.
// Три ширины из тикета: 320, 360, 390.
import { expect, test } from '@playwright/test';
import { fullyInViewport, grantAiConsent, shot, signInMobile, unlockVaultIfAsked } from './harness';

const SIZES: { w: number; h: number }[] = [{ w: 320, h: 568 }, { w: 360, h: 640 }, { w: 390, h: 844 }];
const marker = () => `МР2-${Date.now().toString(36)}`;

for (const { w, h } of SIZES) {
  test.describe(`MR-2: композер достижим на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('поле ввода в экране, отправка обычным кликом, бокового скролла нет', async ({ page }) => {
      const acc = await signInMobile(page, `mr2-${w}`);
      grantAiConsent(acc.uid);
      await page.reload();
      await unlockVaultIfAsked(page, acc.password);

      await page.goto('/ai');
      const composer = page.locator('textarea').last();
      await composer.waitFor({ state: 'visible', timeout: 30_000 });
      expect(await fullyInViewport(composer), 'поле ввода не целиком в экране').toBe(true);

      const text = marker();
      await composer.fill(text);
      const send = page.getByRole('button', { name: /Отправить/ });
      expect(await fullyInViewport(send), 'кнопка «Отправить» не целиком в экране').toBe(true);
      // Именно click(): до MR-2 тап попадал в кнопку «i» ряда персон.
      await send.click();
      await expect(page.getByText(text).first(), 'ход не отправлен обычным кликом')
        .toBeVisible({ timeout: 40_000 });

      // Переполнение меряем по области чата: на 320 px пятая вкладка нижней
      // панели («Диагностика») сама торчит на 8 px — это чинит MR-4 (четыре
      // вкладки), и записывать этот долг на MR-2 незачем.
      const over = await page.evaluate(() => {
        const w = window.innerWidth;
        const nav = document.querySelector('nav');
        const offenders: string[] = [];
        for (const el of Array.from(document.querySelectorAll('main *, [role=main] *'))) {
          if (nav && nav.contains(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width && r.right > w + 1) {
            offenders.push(`${el.tagName}.${(el.className || '').toString().slice(0, 40)} x=${Math.round(r.left)}..${Math.round(r.right)}`);
          }
        }
        return offenders.slice(0, 5);
      });
      expect(over, `горизонтальный скролл в области чата: ${over.join(', ')}`).toEqual([]);
      await shot(page, `mr2-composer-${w}`);
    });

    test('с открытой клавиатурой поле остаётся в экране', async ({ page }) => {
      const acc = await signInMobile(page, `mr2-kb-${w}`);
      grantAiConsent(acc.uid);
      await page.reload();
      await unlockVaultIfAsked(page, acc.password);
      await page.goto('/ai');
      const composer = page.locator('textarea').last();
      await composer.waitFor({ state: 'visible', timeout: 30_000 });

      // Клавиатура в WebView — сжатие visualViewport: уменьшаем окно на 300 px.
      await page.setViewportSize({ width: w, height: h - 300 });
      await composer.click();
      await expect.poll(() => fullyInViewport(composer), {
        timeout: 10_000, message: `с клавиатурой поле ушло за экран (клавиатура ниже на 300 px)`,
      }).toBe(true);
      await shot(page, `mr2-composer-keyboard-${w}`);
    });
  });
}
