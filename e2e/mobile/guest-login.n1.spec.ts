// N-1 (SA-20): телефонный экран входа для гостя.
// Гость на 360×640 и 390×844: без боковой колонки, заголовок без обрезки,
// поля на всю ширину со 16 px (iOS не зумит), метки строчными, «Войти»,
// «Регистрация» и «Забыли пароль?» — в видимой области, тема = системная.
// Аккаунт не нужен: это экран до входа.
import { expect, test } from '@playwright/test';
import { horizontalOverflow, shot } from './harness';

const SCREENS = [
  { w: 360, h: 640 },
  { w: 390, h: 844 },
];

for (const { w, h } of SCREENS) {
  test.describe(`N-1 · гость ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h }, colorScheme: 'light' });

    test('нет сайдбара, заголовок без обрезки, три контрола в кадре, светлая тема', async ({ page }) => {
      await page.goto('/login');
      const h1 = page.locator('h1').first();
      await expect(h1).toBeVisible();
      // Снимок и метрики — до проверок: падение обязано оставить доказательство «как было»,
      // иначе «до» остаётся только в словах.
      await shot(page, `n1-login-light-${w}`);

      const m = await page.evaluate(() => {
        const head = document.querySelector('h1');
        const box = (name: string) => {
          const el = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').trim() === name);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), fits: r.top >= 0 && r.bottom <= window.innerHeight };
        };
        const email = document.querySelector('input[type="email"]') as HTMLInputElement | null;
        const label = document.querySelector('label');
        return {
          nav: document.querySelectorAll('[role="navigation"]').length,
          head: head ? { text: head.textContent, scrollWidth: head.scrollWidth, clientWidth: head.clientWidth, font: getComputedStyle(head).fontSize } : null,
          signIn: box('Войти'), signUp: box('Регистрация'), forgot: box('Забыли пароль?'),
          emailFont: email ? getComputedStyle(email).fontSize : null,
          labelCase: label ? getComputedStyle(label).textTransform : null,
          theme: document.documentElement.className,
          docScrollWidth: document.documentElement.scrollWidth,
        };
      });
      console.warn(`[n-1 ${w}×${h}] ${JSON.stringify(m)}`);

      expect(m.nav, 'гость на телефоне получил боковую колонку').toBe(0);
      await expect(page.locator('[data-testid="mobile-bottom-nav"]')).toHaveCount(0);

      expect(m.head, 'заголовка нет').not.toBeNull();
      expect(m.head!.scrollWidth, `заголовок «${m.head!.text}» обрезан: ${m.head!.scrollWidth} > ${m.head!.clientWidth}`)
        .toBeLessThanOrEqual(m.head!.clientWidth);

      for (const key of ['signIn', 'signUp', 'forgot'] as const) {
        expect(m[key], `«${key}» не найден`).not.toBeNull();
        expect(m[key]!.fits, `«${key}» вне экрана ${w}×${h}: ${m[key]!.top}..${m[key]!.bottom}`).toBe(true);
      }

      // 16 px на полях: iOS иначе зумит поле при фокусе. Метки строчными, без разрядки.
      expect(m.emailFont, 'поле ввода меньше 16 px — Safari зумит').toBe('16px');
      expect(m.labelCase, 'метка осталась капсом').toBe('none');

      // Тема гостя = системная: светлая схема → светлая тема.
      expect(m.theme).toContain('theme-notion');

      const overflow = await horizontalOverflow(page);
      expect(overflow.offenders, `горизонтальный скролл: ${overflow.offenders.join(', ')}`).toEqual([]);
    });

    test('тёмная системная схема → тёмная тема', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('/login');
      await expect(page.locator('h1')).toBeVisible();
      await shot(page, `n1-login-dark-${w}`);
      expect(await page.evaluate(() => document.documentElement.className)).toContain('theme-amethyst');
    });
  });
}

test.describe('N-1 · десктопный вход не изменился', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });

  test('1440: рейка на месте, заголовок 48 px «justwriting.ru», метки капсом', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('[role="navigation"]')).toHaveCount(1);
    const h1 = page.locator('h1').first();
    expect(await h1.textContent()).toBe('justwriting.ru');
    expect(await h1.evaluate((el) => getComputedStyle(el).fontSize)).toBe('48px');
    const labelStyle = await page.locator('label').first().evaluate((el) => getComputedStyle(el).textTransform);
    expect(labelStyle, 'на десктопе метки остались строчными').toBe('uppercase');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await shot(page, 'n1-login-desktop');
  });
});
