// MR-8: шапка архива на телефоне — заголовок, одно поле поиска и один «⋯».
// Три ширины из тикета: 320, 360, 390.
import { expect, test, type Page } from '@playwright/test';
import { openVaultFromBanner, shot, signInMobile, smallTargets, zenOff } from './harness';

const SIZES = [
  { w: 320, h: 568, maxRowY: 230 },
  { w: 360, h: 640, maxRowY: 230 },
  { w: 390, h: 844, maxRowY: 260 },
];

/**
 * Заметки пишем через редактор: с MR-6 это один тап и «Готово», без окон режима.
 * Перезагрузка на каждую заметку — так же идёт реальный пользователь, и нам нужен
 * именно тот список, который приезжает после сохранения.
 */
async function seedNotes(page: Page, n: number): Promise<string[]> {
  const titles: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const title = `МР8 запись ${i + 1}`;
    titles.push(title);
    await page.goto('/');
    const editor = page.locator('textarea').first();
    await editor.waitFor({ state: 'visible', timeout: 30_000 });
    await editor.fill(`${title}. Раз два три четыре пять.`);
    await page.getByRole('button', { name: /^Готово$/ }).click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const field = dialog.getByLabel(/Название/).first();
    if (await field.isVisible().catch(() => false)) await field.fill(title);
    await dialog.getByRole('button', { name: /^Сохранить$/ }).click();
    await page.waitForTimeout(500);
  }
  return titles;
}

for (const { w, h, maxRowY } of SIZES) {
  test.describe(`MR-8: шапка архива на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('первая строка начинается высоко, мусора и ⌘K нет, «⋯» несёт пять строк', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mr8-${w}`);
      const titles = await seedNotes(page, 10);

      await page.goto('/archive');
      // Баннер запертого сейфа стоит в потоке над списком и сдвигает его: до
      // замера открываем сейф тем же путём, что и пользователь.
      await openVaultFromBanner(page, account.password);

      const first = page.getByText(titles[titles.length - 1] ?? '').first();
      await expect(first, 'первая строка не найдена').toBeVisible({ timeout: 20_000 });
      const box = await first.boundingBox();
      expect(box, 'у строки нет геометрии').not.toBeNull();
      console.warn(`[mr8 ${w}] первая строка заметки: y=${Math.round(box!.y)} (порог ${maxRowY})`);
      expect(box!.y, `первая строка начинается с y=${Math.round(box!.y)} (ожидалось < ${maxRowY})`)
        .toBeLessThan(maxRowY);
      await shot(page, `mr8-archive-${w}`);

      await expect(page.getByText('⌘K')).toHaveCount(0);
      await expect(page.getByText(/Архив свободного письма/)).toHaveCount(0);

      await page.getByRole('button', { name: 'Ещё' }).click();
      const sheet = page.getByRole('dialog').last();
      await expect(sheet, 'лист «⋯» не открылся').toBeVisible({ timeout: 15_000 });
      for (const label of [/Вид/, /Сортировка/, /Теги и метки/, /Календарь и статистика/, /Корзина/]) {
        // «Вид» — группа с сегментным переключателем, остальные четыре — строки-кнопки.
        const row = sheet.getByRole('button', { name: label }).or(sheet.getByRole('group', { name: label })).first();
        await expect(row, `в листе нет строки ${label}`).toBeVisible();
        const rb = await row.boundingBox();
        // Ряды `h-12`: на 320 px Chromium отдаёт 47.999969 из-за дробного
        // масштабирования, поэтому порог с допуском субпикселя, а не ровно 48.
        expect(rb && rb.height, `строка ${label} ниже 48 px`).toBeGreaterThanOrEqual(47.5);
      }
      await shot(page, `mr8-menu-${w}`);

      // «Сетка» внутри листа переключает вид; сам лист при этом не закрывается —
      // это переключатель, а не пункт меню.
      await sheet.getByRole('button', { name: 'Сетка' }).click();
      await expect(page.locator('.archive-grid-list').first(), 'сетка не включилась')
        .toBeVisible({ timeout: 10_000 });

      // «Корзина» — уже из следующего открытия: под открытым листом шапка не
      // кликабельна.
      await sheet.getByRole('button', { name: /^Закрыть$/ }).click();
      await expect(sheet, '«⋯» не закрывается кнопкой').toBeHidden({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Ещё' }).click();
      await page.getByRole('dialog').last().getByRole('button', { name: /Корзина/ }).click();
      // exact: иначе «Корзина пуста» из пустой корзины тоже попадает в выборку.
      await expect(page.getByRole('heading', { name: 'Корзина', exact: true })).toBeVisible({ timeout: 15_000 });
    });

    test('в шапке архива нет целей касания меньше 44 px', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mr8-targets-${w}`);
      await page.goto('/archive');
      await openVaultFromBanner(page, account.password);
      const header = page.locator('h1').locator('xpath=ancestor::div[2]');
      await expect(header).toBeVisible({ timeout: 20_000 });
      const small = await header.evaluate(el => {
        const out: string[] = [];
        for (const b of Array.from(el.querySelectorAll('button'))) {
          const r = b.getBoundingClientRect();
          if (r.width && (r.width < 44 || r.height < 44)) out.push(`${b.getAttribute('aria-label') || b.textContent} ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
        return out;
      });
      expect(small, `мелкие цели в шапке: ${small.join(', ')}`).toEqual([]);
      // Снимок для отчёта: весь экран.
      const all = await smallTargets(page);
      console.warn(`[mr8 ${w}] мелкие цели на странице: ${JSON.stringify(all.slice(0, 6))}`);
    });
  });
}
