// MQ-11: окно «Разблокировать шифрование» на телефоне — лист; поля ≥ 16 px (iOS не увеличит
// страницу), плейсхолдер ≥ 4,5:1, «×» и кнопки ≥ 44 px.
import { expect, test } from '@playwright/test';
import { shot, signInMobileLockedVault } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

test('MQ-11: окно сейфа — лист с полем 16 px и целями 44 px', async ({ page }) => {
  await signInMobileLockedVault(page, 'mq11-unlock');
  await page.goto('/archive');
  // Окно разблокировки поднимается само при заходе в архив с запертым сейфом; если нет — открываем из баннера.
  const dialog = page.getByRole('dialog').last();
  if (!(await dialog.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false))) {
    await page.getByRole('button', { name: /^Открыть сейф$/ }).first().click({ timeout: 30_000 });
  }
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);

  const facts = await dialog.evaluate(el => {
    const lum = (c: number[]) => {
      const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
    };
    const parse = (s: string) => (/rgba?\(([^)]+)\)/.exec(s)?.[1] ?? '0,0,0').split(',').map(x => parseFloat(x));
    const input = el.querySelector('input[type="password"]') as HTMLInputElement;
    const ph = parse(getComputedStyle(input, '::placeholder').color);
    const bg = parse(getComputedStyle(el).backgroundColor);
    const [hi, lo] = [lum(ph), lum(bg)].sort((a, b) => b - a) as [number, number];
    const box = (e: Element) => e.getBoundingClientRect();
    const close = el.querySelector('button[aria-label="Закрыть"]');
    const submit = Array.from(el.querySelectorAll('button[type="submit"]'))[0];
    return {
      fontSize: parseFloat(getComputedStyle(input).fontSize),
      contrast: (hi + 0.05) / (lo + 0.05),
      bgAlpha: bg[3] ?? 1,
      closeH: close ? box(close).height : 0, closeW: close ? box(close).width : 0,
      submitH: submit ? box(submit).height : 0,
      bottomAligned: Math.round(box(el).bottom) === window.innerHeight,
    };
  });
  expect(facts.fontSize, `размер шрифта поля: ${facts.fontSize}`).toBeGreaterThanOrEqual(16);
  expect(facts.contrast, `контраст плейсхолдера: ${facts.contrast.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  expect(facts.bgAlpha, 'фон листа прозрачен').toBe(1);
  expect(facts.bottomAligned, 'окно не лист у нижнего края').toBe(true);
  expect(Math.min(facts.closeH, facts.closeW), '«×» меньше 44 px').toBeGreaterThanOrEqual(44);
  expect(facts.submitH, 'кнопка ниже 44 px').toBeGreaterThanOrEqual(44);
  await shot(page, 'mq11-unlock-sheet-390');
});
