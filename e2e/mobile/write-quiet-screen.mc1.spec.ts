// MC-1: экран письма до первой буквы — одна строка наверху, токен режима в панели,
// «Сохранить» (MF-3: дискета) выключено, кнопки «Начать» нет (сессию начинает первая буква).
import { expect, test } from '@playwright/test';
import { DICTATION_ENGINE, shot, signInMobile, waitForMobileSettled, zenOff } from './harness';

for (const { w, h } of [{ w: 360, h: 640 }, { w: 390, h: 844 }]) {
  test.describe(`MC-1: тихий экран письма на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('над полем одна цель, в панели три, «Сохранить» активируется словами', async ({ page }) => {
      await zenOff(page);
      // Микрофон существует только если браузер отдаёт SpeechRecognition;
      // считаем цели честно, поэтому ставим заглушку движка (та же, что в MB-5).
      await page.addInitScript(DICTATION_ENGINE);
      const account = await signInMobile(page, `mc1-quiet-${w}`);
      await page.goto('/');
      // После навигации приложение ещё догружает состояние сейфа и права на
      // мобильный макет: в этом кадре над полем виден «Открыть сейф». Ждём
      // устойчивого состояния — тот же барьер, что и входе.
      await waitForMobileSettled(page, account.password);

      const area = page.locator('textarea').first();
      await area.waitFor({ state: 'visible', timeout: 30_000 });

      const above = await page.evaluate(() => {
        const ta = document.querySelector('textarea')!;
        const taTop = ta.getBoundingClientRect().top;
        const sel = 'button, a[href], [role="button"], input:not([type="hidden"]), select';
        return Array.from(document.querySelectorAll(sel))
          .filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.bottom <= taTop + 1;
          })
          .map(el => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30));
      });
      // На свежем аккаунте серии нет (правило MC-1/K5), поэтому над текстом из
      // целей только «Aa» и скрытый до фокуса skip-link — те самые две цели
      // тикета. «Начать» и токен режима здесь больше не живут; нижняя панель
      // под полем, поэтому геометрией она не считается.
      expect(above, `над полем unexpected цели: ${JSON.stringify(above)}`)
        .toEqual(['Перейти к содержимому', 'Настройки']);

      const toolbar = page.locator('[data-write-toolbar]');
      await expect(toolbar).toBeVisible();
      const toolbarButtons = await toolbar.locator('button').count();
      expect(toolbarButtons, `в панели ${toolbarButtons} целей вместо трёх`).toBe(3);
      await expect(toolbar.getByRole('button', { name: /^Сохранить$/ })).toBeDisabled();
      await expect(toolbar.getByRole('button', { name: 'Начать' })).toHaveCount(0);
      await shot(page, `mc1-write-idle-${w}`);

      // Первая буква начинает сессию (MR-6), и «Сохранить» включается.
      await area.fill('раз два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать');
      const done = toolbar.getByRole('button', { name: /^Сохранить$/ });
      await expect(done, '«Сохранить» не стала активной').toBeEnabled({ timeout: 15_000 });
      expect(await done.boundingBox(), 'у «Сохранить» нет геометрии').not.toBeNull();
      expect((await done.boundingBox())!.height, '«Сохранить» ниже 44 px').toBeGreaterThanOrEqual(44);
      await shot(page, `mc1-write-running-${w}`);

      await done.click();
      const finish = page.getByRole('dialog').last();
      await expect(finish, '«Сохранить» не открыла окно завершения').toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[aria-labelledby="finish-modal-title"]')).toBeVisible();
    });

    test('токен режима в панели открывает настройку сессии', async ({ page }) => {
      await zenOff(page);
      await page.addInitScript(DICTATION_ENGINE);
      await signInMobile(page, `mc1-mode-${w}`);
      await page.goto('/');

      const token = page.getByRole('button', { name: 'Режим сессии' });
      await expect(token, 'токена режима в панели нет').toBeVisible({ timeout: 30_000 });
      const box = await token.boundingBox();
      const toolbarBox = await page.locator('[data-write-toolbar]').boundingBox();
      expect(box && toolbarBox && box.y >= toolbarBox.y - 1, 'токен режима не в панели письма').toBe(true);
      await token.click();
      const sheet = page.getByRole('dialog').filter({ hasText: /Свободный поток/ }).first();
      await expect(sheet, 'окно настройки сессии не открылось').toBeVisible({ timeout: 15_000 });
      await shot(page, `mc1-mode-sheet-${w}`);
    });
  });
}
