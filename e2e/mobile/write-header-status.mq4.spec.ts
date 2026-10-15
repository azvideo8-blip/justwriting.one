// MQ-4: статус сохранения в шапке письма не выходит за экран, «Aa» прижата к правому краю.
import { expect, test } from '@playwright/test';
import { shot, signInMobile, waitForMobileSettled, zenOff } from './harness';

for (const { w, h } of [{ w: 360, h: 640 }, { w: 390, h: 844 }]) {
  test.describe(`MQ-4: шапка письма на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('пока идёт и проходит сохранение, все дети шапки внутри экрана, «Aa» у края', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mq4-status-${w}`);
      await page.goto('/');
      await waitForMobileSettled(page, account.password);
      const area = page.locator('textarea').first();
      await area.waitFor({ state: 'visible', timeout: 30_000 });

      // До первого сохранения «Aa» уже у края: пустых 60 px справа больше нет.
      const aaBefore = await page.getByRole('button', { name: 'Настройки' }).first().boundingBox();
      expect(aaBefore!.x + aaBefore!.width, `«Aa» не у края: right=${aaBefore!.x + aaBefore!.width}`).toBeGreaterThanOrEqual(w - 20);

      await area.fill('Раз два три четыре пять шесть семь восемь девять десять.');
      // Автосохранение на телефоне — через 5 с; сэмплируем шапку каждые 150 мс, пока не увидим статус.
      const result = await page.evaluate(async (width) => {
        const seen: string[] = [];
        const bad: string[] = [];
        const t0 = performance.now();
        while (performance.now() - t0 < 14_000) {
          const row = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Настройки')?.parentElement;
          const status = document.querySelector('[data-testid="save-status-text"]');
          if (status) seen.push(status.textContent ?? '');
          for (const el of Array.from(row?.children ?? []) as HTMLElement[]) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > width + 0.5) bad.push(`${el.tagName}:${el.textContent?.slice(0, 20)} right=${Math.round(r.right)}`);
          }
          if (seen.some(s => /охранено|Saved/.test(s)) && performance.now() - t0 > 6_000) break;
          await new Promise(r => setTimeout(r, 150));
        }
        const aa = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Настройки')!.getBoundingClientRect();
        return { seen: Array.from(new Set(seen)), bad: Array.from(new Set(bad)), aaRight: Math.round(aa.right) };
      }, w);

      expect(result.seen.length, 'статус сохранения ни разу не показан').toBeGreaterThan(0);
      expect(result.bad, `дети шапки за краем: ${JSON.stringify(result)}`).toEqual([]);
      expect(result.aaRight, `«Aa» не у края: ${result.aaRight}`).toBeGreaterThanOrEqual(w - 20);
      await shot(page, `mq4-write-header-${w}`);
    });
  });
}
