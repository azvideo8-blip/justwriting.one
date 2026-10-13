// MB-6 (F-5): подсказка «нужно согласие на ИИ» на телефоне. Это первый экран
// чата, который видит новый человек: текст стоял в один ряд с двумя ссылками,
// сжимался в столбик по слову, а «Закрыть» уезжал за правый край.
import { expect, test } from '@playwright/test';
import { fullyInViewport, shot, signInMobile } from './harness';

test.use({ viewport: { width: 360, height: 640 } });

test.describe('MB-6: подсказка согласия ИИ читается на 360 px', () => {
  test('текст занимает ширину, кнопки под ним и целиком в экране', async ({ page }) => {
    // Аккаунт без согласия на ИИ: сервер отвечает кодом согласия, и подсказка
    // появляется в чате. Согласие намеренно не выдаётся.
    await signInMobile(page, 'mb6-consent');

    await page.goto('/ai');
    const composer = page.locator('textarea, input[type="text"]').last();
    await composer.waitFor({ state: 'visible', timeout: 30_000 });
    await composer.fill('Что ты помнишь про мою неделю?');
    // Кнопка «Отправить» на телефоне — иконка без доступного имени (F-17,
    // отдельная правка), поэтому ход отправляется клавишей ввода.
    await composer.press('Enter');

    const hint = page.getByRole('status').filter({ hasText: /разрешите|настройки/i }).last();
    await expect(hint, 'подсказка о согласии не появилась').toBeVisible({ timeout: 20_000 });

    const close = hint.getByRole('button', { name: /^Закрыть$/ });
    const open = hint.getByRole('button', { name: /Открыть настройки/ });
    await expect(close).toBeVisible();
    await expect(open).toBeVisible();

    const geom = await hint.evaluate(el => {
      const span = el.querySelector('span');
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        textWidth: span ? Math.round(span.getBoundingClientRect().width) : -1,
      };
    });
    console.warn('[mb6] блок согласия', JSON.stringify(geom));
    expect(await fullyInViewport(close), '«Закрыть» за краем экрана').toBe(true);
    expect(await fullyInViewport(open), '«Открыть настройки» за краем экрана').toBe(true);
    expect(geom.scrollWidth, 'блок шире экрана: есть горизонтальный скролл')
      .toBeLessThanOrEqual(geom.clientWidth + 1);
    expect(geom.textWidth, 'текст сжат в столбик по слову').toBeGreaterThan(200);

    // Кнопки — цели касания не меньше 44 px.
    for (const btn of [close, open]) {
      const box = await btn.boundingBox();
      expect(box, 'нет геометрии у кнопки').not.toBeNull();
      if (box) expect(box.height, `кнопка ${Math.round(box.height)} px высотой`).toBeGreaterThanOrEqual(44);
    }

    await shot(page, 'mb6-ai-consent-hint-360');
  });
});
