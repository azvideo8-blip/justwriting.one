// Владелец 28.10: шапка «Заметок» на телефоне была выше, чем у «Профиля»: 32 px
// пустоты над заголовком (pt-8 общей обёртки) и шрифт 24. Теперь она как у
// «Профиля» — у самого верха, 18 px.
import { expect, test, type Page } from '@playwright/test';
import { openVaultFromBanner, shot, signInMobile, zenOff } from './harness';

const heading = (page: Page) => page.locator('#main-content h1, header h1').first();

test.use({ viewport: { width: 390, height: 844 } });

test('шапка «Заметок» у верха и того же размера, что у «Профиля»', async ({ page }) => {
  await zenOff(page);
  const account = await signInMobile(page, 'archive-hdr');

  await page.goto('/me');
  await expect(heading(page)).toHaveText('Профиль', { timeout: 15_000 });
  const me = await heading(page).evaluate(h => ({ top: h.getBoundingClientRect().top, font: getComputedStyle(h).fontSize }));

  await page.goto('/archive');
  await openVaultFromBanner(page, account.password);
  await expect(heading(page)).toHaveText('Заметки', { timeout: 15_000 });
  const notes = await heading(page).evaluate(h => ({ top: h.getBoundingClientRect().top, font: getComputedStyle(h).fontSize }));
  await shot(page, 'archive-header-compact-390');

  expect(notes.font, 'шрифт заголовка не как у «Профиля»').toBe(me.font);
  expect(Math.abs(notes.top - me.top), `заголовок «Заметок» на ${notes.top}, у «Профиля» на ${me.top}`).toBeLessThanOrEqual(4);
});
