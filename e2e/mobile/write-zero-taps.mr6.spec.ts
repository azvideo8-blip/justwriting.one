// MR-6 (направление A): «Писать» открывает редактор — до первой буквы нет ни
// «Начать», ни окна режима. Проверка «/» на отсутствие бокового скролла вернулась
// сюда: экран-заглушка, который его давал, удалён.
import { expect, test } from '@playwright/test';
import { fullyInViewport, openVaultFromBanner, shot, signInMobile } from './harness';

const SIZES = [{ w: 360, h: 640 }, { w: 390, h: 844 }];

for (const { w, h } of SIZES) {
  test.describe(`MR-6: редактор открыт сразу на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('тап по тексту → фокус, 12 слов → сессия идёт, «Готово» завершает', async ({ page }) => {
      const account = await signInMobile(page, `mr6-${w}`);
      await page.goto('/');

      const area = page.locator('textarea');
      await expect(area, 'редактор не открыт').toBeVisible({ timeout: 30_000 });
      // Без «Начать» и без «Недавних»: до буквы — один экран.
      // «Начать» остаётся в тулбаре как кнопка запуска сессии (44×44) — это
      // правильно. Полноэкранного стартера (был 140 px) быть не должно: проверяем, что
      // кнопки «Начать» крупнее тулбарной (была 140 px) на экране нет.
      const bigStart = await page.evaluate(() => {
        const hits: string[] = [];
        for (const b of Array.from(document.querySelectorAll('button'))) {
          const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
          if (!/^Начать/.test(name)) continue;
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.height > 56) hits.push(`${name} ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
        return hits;
      });
      expect(bigStart, `полноэкранный стартер вернулся: ${bigStart.join(', ')}`).toEqual([]);
      await expect(page.getByText(/Недавние/)).toHaveCount(0);
      // И без автофокуса: на Android он выбрасывал клавиатуру на пол-экрана.
      expect(await area.evaluate(el => el === document.activeElement), 'поле перехватило фокус').toBe(false);

      await area.click();
      await expect.poll(() => area.evaluate(el => el === document.activeElement), { timeout: 10_000 })
        .toBe(true);

      const marker = `МР6-${Date.now().toString(36)}`;
      await area.fill(`${marker} ${'раз два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать'}`);
      const done = page.getByRole('button', { name: /Готово/ });
      await expect(done, '«Готово» не стала активной').toBeEnabled({ timeout: 15_000 });
      expect(await fullyInViewport(done), '«Готово» за экраном').toBe(true);
      // В проверочном тексте 13 слов (маркер + 12): важен сам факт, что счётчик
      // перестал быть нулевым, а не конкретное число.
      const counter = page.getByText(/\d+ слов/).first();
      await expect(counter, 'счётчик слов не появился').toBeVisible({ timeout: 15_000 });
      expect(await counter.textContent(), 'счётчик остался нулевым').not.toMatch(/^0\s/);
      await shot(page, `mr6-writing-${w}`);

      await done.click();
      const dialog = page.getByRole('dialog').last();
      await expect(dialog, 'окно завершения не открылось').toBeVisible({ timeout: 15_000 });
      await dialog.getByRole('button', { name: /Сохранить/ }).click();
      // Окно закрывается в onSuccess — то есть после того, как запись легла.
      // Без этого goto ниже перезагружал страницу через 250 мс после «Сохранить»
      // и обрывал шифрование и запись (CI 0.9.39: «запись не появилась в архиве»).
      await expect(page.locator('[aria-labelledby="finish-modal-title"]'), 'окно завершения не закрылось — сохранение не дошло')
        .toBeHidden({ timeout: 20_000 });
      // WebKit роняет «Frame load interrupted», если `goto` стартует в тот момент,
      // когда приложение само дописывает навигацию после сохранения. Пробуем ещё
      // раз: запись в архиве по-прежнему проверяет следующий expect, поэтому
      // настоящий дефект этим не спрятать.
      await page.goto('/archive').catch(async () => {
        await page.waitForLoadState('domcontentloaded');
        await page.goto('/archive');
      });
      // На WebKit ключ сейфа переживает перезагрузку не так, как в Chromium:
      // список приезжает с запертым сейфом, и вместо заголовка там плашка
      // «не удалось расшифровать» — ровно та причина, по которой спек думает,
      // что записи нет.
      await openVaultFromBanner(page, account.password);
      await expect(page.getByText(marker).first(), 'запись не появилась в архиве')
        .toBeVisible({ timeout: 20_000 });
    });

    test('токен режима открывает окно настройки сессии, таймер стартует с обратным отсчётом', async ({ page }) => {
      await signInMobile(page, `mr6-mode-${w}`);
      await page.goto('/');

      await page.getByRole('button', { name: /Режим сессии/ }).click();
      const sheet = page.getByRole('dialog').last();
      await expect(sheet, 'окно режима не открылось').toBeVisible({ timeout: 15_000 });
      await sheet.getByRole('button', { name: /По таймеру/ }).click();
      const field = sheet.getByRole('spinbutton').or(sheet.locator('input[type="number"], input[type="text"]')).first();
      await field.fill('15');
      await sheet.getByRole('button', { name: /^Начать$/ }).click();

      // Обратный отсчёт: минуты:секунды, и они идут вниз от 15:00.
      // После «Начать» в листе режима идёт обратный отсчёт 3-2-1, затем таймер:
      // ждём любую метку мм:сс, отличную от нулевой.
      await expect(page.getByText(/\d{1,2}:\d{2}(?!$)/).first(), 'таймер не появился')
        .toBeVisible({ timeout: 25_000 });
      await shot(page, `mr6-mode-timer-${w}`);
    });

    test('на / нет горизонтального скролла', async ({ page }) => {
      await signInMobile(page, `mr6-overflow-${w}`);
      await page.goto('/');
      // Меряем, когда страница успокоилась: первый CI-прогон 0.9.39 поймал на 360
      // блок посреди анимации появления (x=-86..130), которого через секунду уже
      // нет, а на 390 и локально тот же тест зелёный. Элемент, который торчит за
      // край постоянно, не пропадёт и через 10 с — проверка его по-прежнему ловит.
      const measure = () => page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > vw + 1 || r.left < -1)) {
            out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} x=${Math.round(r.left)}..${Math.round(r.right)}`);
          }
        }
        return out.slice(0, 5);
      });
      await expect.poll(measure, { timeout: 10_000, intervals: [500, 1_000] }).toEqual([]);
    });
  });
}
