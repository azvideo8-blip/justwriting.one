// MB-4 (F-4, F-23): модалки и листы — через портал в document.body, поэтому
// нижняя панель и её чипы больше не лежат поверх кнопок окна, а `fixed`
// считается от viewport, а не от предка с transform.
//
// Что именно проверяется: окно может геометрически перекрываться с панелью — это
// нормально, если оно нарисовано поверх. Ненормально — когда клик по кнопке окна
// попадает в панель. Поэтому снимается не «пересечения нет», а «в каждой точке
// кнопки отзывается сама кнопка». Центр ловил кнопку и до правки (разница была в
// 7 px), а нижняя четверть — нет.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { fullyInViewport, shot, signInMobile, zenOff } from './harness';

interface Box { x: number; y: number; width: number; height: number }

/** Что отзывается под точкой на доле h от верхнего края прямоугольника. */
function hitAt(page: Page, box: Box, frac: number): Promise<string> {
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height * frac);
  return page.evaluate(({ px, py }: { px: number; py: number }) => {
    const stack = document.elementsFromPoint(px, py).slice(0, 4).map(el => {
      const inDialog = !!el.closest('[role="dialog"]') || el.matches('[role="dialog"]');
      const inBar = !!el.closest('[class*="--z-sidebar"]');
      return `${el.tagName.toLowerCase()}${inDialog ? ' ✓окно' : ''}${inBar ? ' ✗панель' : ''}`;
    });
    return stack.join(' > ') || '—';
  }, { px: x, py: y });
}

async function hitPoints(page: Page, loc: Locator): Promise<string[]> {
  const box = await loc.boundingBox();
  if (!box) throw new Error('нет геометрии у элемента');
  const out: string[] = [];
  for (const frac of [0.25, 0.5, 0.85]) out.push(`${frac}: ${await hitAt(page, box, frac)}`);
  return out;
}

test.describe('MB-4: окно завершения над нижней панелью', () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test('кнопка «Сохранить» отзывается целиком, а не только своим центром', async ({ page }) => {
    await zenOff(page);
    await signInMobile(page, 'mb4-finish');

    // MR-6 (направление A): редактор открыт сразу, «Начать» и лист режима не нужны.
    await page.goto('/');
    const editor = page.locator('textarea').first();
    await editor.waitFor({ state: 'visible', timeout: 30_000 });
    // Длинный текст — как в улике F-4: окно выше экрана, и ряд кнопок упирается
    // в нижнюю панель.
    await editor.fill('Проверка окна завершения на телефоне. ' + 'Один два три четыре пять. '.repeat(6));

    await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_200);

    const save = dialog.getByRole('button', { name: /^Сохранить$/ });
    await expect(save).toBeVisible();
    const state = await dialog.evaluate(el => ({
      inMain: !!el.closest('main'),
      parentIsBody: el.parentElement?.parentElement === document.body,
    }));
    console.warn('[mb4] «Сохранить»', JSON.stringify(await save.boundingBox()),
      'панель', JSON.stringify(await page.evaluate(() => {
        const el = document.querySelector('[class*="--z-sidebar"]');
        const r = el?.getBoundingClientRect();
        return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom) } : null;
      })),
      'окно', JSON.stringify(state));
    const hits = await hitPoints(page, save);
    console.warn('[mb4] точки', JSON.stringify(hits));

    expect(state.inMain, 'окно всё ещё внутри main').toBe(false);
    expect(state.parentIsBody, 'портал не в document.body').toBe(true);
    for (const hit of hits) {
      expect(hit, `клик по «Сохранить» (${hit})`).toContain('✓окно');
      expect(hit, `клик по «Сохранить» (${hit})`).not.toContain('✗панель');
    }
    await shot(page, 'mb4-finish-dialog-360');
  });
});

test.describe('MB-4: лист действий с заметкой на 320 px', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('лист целиком в экране, точка вне листа — подложка, а не страница', async ({ page }) => {
    await zenOff(page);
    await signInMobile(page, 'mb4-sheet');

    // Заметка нужна, чтобы открыть её лист действий: пишем и сохраняем.
    // MR-6 (направление A): редактор открыт сразу, «Начать» и лист режима не нужны.
    await page.goto('/');
    const editor = page.locator('textarea').first();
    await editor.waitFor({ state: 'visible', timeout: 30_000 });
    await editor.fill('Заметка для листа действий. Раз два три.');
    await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
    const finish = page.getByRole('dialog').first();
    await expect(finish).toBeVisible({ timeout: 15_000 });
    await finish.getByRole('button', { name: /^Сохранить$/ }).click();
    await page.waitForTimeout(1_500);

    await page.getByRole('button', { name: 'Заметки' }).click();
    const actions = page.getByRole('button', { name: /Действия с заметкой/ }).first();
    await expect(actions).toBeVisible({ timeout: 20_000 });
    await actions.click();

    const sheet = page.getByRole('dialog').first();
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    // Лист въезжает снизу пружиной (initial y: '100%'): мерить надо в покое,
    // иначе снимаешь координаты посреди анимации и нижний край «за экраном».
    await expect
      .poll(async () => {
        const b = await sheet.boundingBox();
        return b ? Math.round(b.y + b.height) : -1;
      }, { timeout: 10_000 })
      .toBe(await page.evaluate(() => window.innerHeight));

    const settled = await sheet.boundingBox();
    console.warn('[mb4] лист в покое', JSON.stringify(settled), 'экран',
      JSON.stringify(await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))));
    expect(await fullyInViewport(sheet), 'лист залезает за край экрана').toBe(true);
    if (settled) expect(settled.x, 'лист уехал за левый край').toBeGreaterThanOrEqual(0);

    // Точка выше листа: попасть надо в подложку, а не в страницу за ней.
    const outside = await page.evaluate(() => {
      const el = document.elementFromPoint(8, 60);
      if (!el) return '—';
      const tag = el.tagName.toLowerCase();
      return `${tag}${el.closest('main') ? ' [в main]' : ''}${el.closest('[role="dialog"]') ? ' [в листе]' : ''}`;
    });
    expect(outside, `точка вне листа попала в ${outside}`).not.toContain('[в main]');
    expect(outside).not.toContain('[в листе]');
    await shot(page, 'mb4-note-actions-sheet-320');
  });

  test('подтверждение поверх листа: два окна, Esc снимает только верхнее', async ({ page }) => {
    await zenOff(page);
    await signInMobile(page, 'mb4-nested');

    // MR-6 (направление A): редактор открыт сразу, «Начать» и лист режима не нужны.
    await page.goto('/');
    const editor = page.locator('textarea').first();
    await editor.waitFor({ state: 'visible', timeout: 30_000 });
    await editor.fill('Заметка для вложенного подтверждения. Раз два.');
    await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
    const finish = page.getByRole('dialog').first();
    await expect(finish).toBeVisible({ timeout: 15_000 });
    await finish.getByRole('button', { name: /^Сохранить$/ }).click();
    await page.waitForTimeout(1_500);

    await page.getByRole('button', { name: 'Заметки' }).click();
    const actions = page.getByRole('button', { name: /Действия с заметкой/ }).first();
    await expect(actions).toBeVisible({ timeout: 20_000 });
    await actions.click();
    const sheet = page.getByRole('dialog').first();
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    // Подтверждение поверх листа — тот самый случай, где раньше путались слои.
    await sheet.getByRole('button', { name: /Не показывать ИИ|Скрыть от ИИ/ }).first().click();
    const dialogs = page.getByRole('dialog');
    await expect(dialogs).toHaveCount(2, { timeout: 10_000 });
    const confirmBox = await dialogs.nth(1).boundingBox();
    console.warn('[mb4] вложенные окна', JSON.stringify(await dialogs.first().boundingBox()), JSON.stringify(confirmBox));

    // Верхнее окно — то, что под пальцем: его кнопки кликабельны.
    const yes = dialogs.nth(1).getByRole('button', { name: /Да, скрыть|Скрыть/ }).first();
    await expect(yes).toBeVisible();
    const box = await yes.boundingBox();
    if (box) {
      const hit = await hitAt(page, box, 0.5);
      expect(hit, `под кнопкой подтверждения ${hit}`).toContain('✓окно');
    }

    await page.keyboard.press('Escape');
    await expect(dialogs).toHaveCount(1, { timeout: 10_000 });
    await shot(page, 'mb4-nested-confirm-320');
  });
});
