// MB-8 (F-8): баннер «Сейф заперт — синхронизация на паузе» лежал fixed поверх
// заголовков страниц и шапки чата. На телефоне он встаёт в поток: заголовок
// страницы его не перекрывает и он не перекрывает заголовок. Сам баннер остаётся
// — это честное состояние.
import { expect, test } from '@playwright/test';
import { shot, signInMobileLockedVault } from './harness';

test.use({ viewport: { width: 320, height: 568 } });

test.describe('MB-8: баннер сейфа не закрывает заголовок страницы', () => {
  test('h1 не пересекается с баннером, «Открыть сейф» — цель касания 44 px', async ({ page }) => {
    await signInMobileLockedVault(page, 'mb8-banner');

    await page.goto('/archive');
    const banner = page.getByRole('status').filter({ hasText: /Сейф заперт/ }).first();
    await expect(banner, 'баннера о запертом сейфе не видно').toBeVisible({ timeout: 20_000 });

    const heading = page.getByRole('heading', { level: 1 }).first();
    await expect(heading).toBeVisible();

    const geometry = await Promise.all([banner.boundingBox(), heading.boundingBox()]);
    const [b, h] = geometry;
    console.warn('[mb8] баннер', JSON.stringify(b), 'заголовок', JSON.stringify(h));
    expect(b, 'нет геометрии у баннера').not.toBeNull();
    expect(h, 'нет геометрии у заголовка').not.toBeNull();
    if (b && h) {
      const intersects = h.y < b.y + b.height && b.y < h.y + h.height;
      expect(intersects, `заголовок лежит под баннером: баннер ${Math.round(b.y)}..${Math.round(b.y + b.height)}, h1 ${Math.round(h.y)}..${Math.round(h.y + h.height)}`).toBe(false);
      expect(h.y, 'заголовок начался выше баннера').toBeGreaterThanOrEqual(b.y);
    }

    // MB-8 ровно про это: на телефоне баннер занимает место в потоке, а не
    // висит fixed над содержимым.
    const position = await banner.evaluate(el => getComputedStyle(el).position);
    console.warn('[mb8] позиция баннера:', position);
    expect(position, 'баннер всё ещё лежит поверх содержимого').toBe('relative');

    const openVault = banner.getByRole('button', { name: /Открыть сейф/ });
    await expect(openVault).toBeVisible();
    const box = await openVault.boundingBox();
    console.warn('[mb8] «Открыть сейф»', JSON.stringify(box));
    expect(box, 'нет геометрии у кнопки').not.toBeNull();
    if (box) expect(Math.round(box.height), '«Открыть сейф» меньше 44 px высотой').toBeGreaterThanOrEqual(44);

    // Без горизонтального скролла на 320 px.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `горизонтальный скролл +${overflow}px`).toBeLessThanOrEqual(0);

    await shot(page, 'mb8-vault-banner-320');
  });
});
