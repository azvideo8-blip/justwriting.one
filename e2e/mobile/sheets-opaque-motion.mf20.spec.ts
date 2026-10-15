// MF-20 (SA-7 + SA-6): листы на телефоне были прозрачны на 60 % (`--surface-card`
// аметиста — rgba(…, 0.4)) и исчезали за один кадр. Теперь фон листа
// непрозрачный во всех четырёх темах, а уход — вниз за ~200 мс.
import { expect, test, type Page } from '@playwright/test';
import { shot, signInMobile, zenOff } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

const THEMES = ['amethyst', 'modern', 'notion', 'spotify'] as const;

async function openSetupSheet(page: Page) {
  await page.goto('/');
  await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('[data-write-toolbar]').getByRole('button', { name: 'Режим сессии' }).click();
  const sheet = page.getByRole('dialog').last();
  await expect(sheet).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(500);
  return sheet;
}

test('MF-20: фон листа непрозрачен в четырёх темах; закрытие — уход вниз, а не склейка', async ({ page }) => {
  await zenOff(page);
  await signInMobile(page, 'mf20-sheets');

  for (const theme of THEMES) {
    await page.evaluate((t) => localStorage.setItem('app-theme', JSON.stringify(t)), theme);
    const sheet = await openSetupSheet(page);
    const bg = await sheet.evaluate(el => getComputedStyle(el).backgroundColor);
    const alpha = /rgba?\(([^)]+)\)/.exec(bg)?.[1]?.split(',').map(s => s.trim())[3];
    await shot(page, `mf20-sheet-${theme}`);
    expect.soft(alpha === undefined || Number(alpha) === 1, `${theme}: фон листа ${bg}`).toBe(true);
    await page.keyboard.press('Escape').catch(() => {});
  }

  // Уход: после «Закрыть» лист ещё в DOM и едет вниз.
  const sheet = await openSetupSheet(page);
  await expect(sheet.getByRole('button', { name: 'Закрыть' }).first()).toBeVisible();
  // Клик — внутри выборки: часы идут от самого нажатия, а не от ответа Playwright.
  const samples = await page.evaluate(() => new Promise<{ t: number; y: number | null }[]>(resolve => {
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).pop() as HTMLElement;
    const close = Array.from(dialog.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Закрыть') as HTMLElement;
    const out: { t: number; y: number | null }[] = [];
    const start = performance.now();
    close.click();
    const tick = () => {
      const el = dialog.isConnected ? dialog : null;
      out.push({ t: Math.round(performance.now() - start), y: el ? Math.round(el.getBoundingClientRect().top) : null });
      if (performance.now() - start < 400) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  }));
  const alive = samples.filter(s => s.y !== null);
  console.warn('[mf20] выборка ухода:', JSON.stringify(samples.filter((_, i) => i % 3 === 0)));
  const lastAlive = alive[alive.length - 1];
  expect(lastAlive?.t ?? 0, 'лист исчез за один кадр').toBeGreaterThanOrEqual(150);
  const ys = alive.map(s => s.y!);
  expect(ys[ys.length - 1]! > ys[0]!, 'лист не уезжает вниз').toBe(true);
});
