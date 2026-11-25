// 0.11.26: на десктопе клик мышью по карандашу метки попадал в «Удалить метку» —
// запас 44 px у соседней кнопки 16 px (`clickable-target-expansion`) лежал поверх
// карандаша и правой половины фишки. То же у тегов.
import { expect, test, devices, type Locator } from '@playwright/test';
import { signInMobile, zenOff } from './harness';

test.use({ ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } });

/** Какая кнопка на самом деле получит клик в точках сетки по элементу. */
const hits = (el: Locator) => el.evaluate(node => {
  const r = node.getBoundingClientRect();
  const at = [0.2, 0.5, 0.8];
  return [...new Set(at.flatMap(x => at.map(y =>
    document.elementFromPoint(r.left + r.width * x, r.top + r.height * y)?.closest('button')?.getAttribute('aria-label') ?? 'фишка')))];
});

test('карандаш и крестик у метки и тега получают свои клики', async ({ page }) => {
  await zenOff(page);
  await signInMobile(page, 'pencil');
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill('Синтетическая заметка для проверки карандаша.');
  await page.keyboard.press('Control+s');
  const finish = page.locator('[aria-labelledby="finish-modal-title"]');
  const tag = finish.getByLabel(/Добавить тег/);
  await tag.fill('обжиг');
  await tag.press('Enter');
  await page.getByRole('dialog').last().getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(finish).toBeHidden({ timeout: 20_000 });

  await page.goto('/archive');
  await page.getByRole('button', { name: 'Теги', exact: true }).click();
  await page.getByRole('button', { name: /Добавить метку/ }).click();
  await page.getByPlaceholder('Название...').fill('Мастерская');
  await page.keyboard.press('Enter');
  await expect(page.getByPlaceholder('Название...')).toBeHidden({ timeout: 15_000 });

  for (const [chip, rename, remove] of [
    [page.locator('.group\\/label', { hasText: 'Мастерская' }), 'Переименовать метку', 'Удалить метку'],
    // Та же группа есть у тегов в строке заметки — там нет карандаша.
    [page.locator('.group\\/tag', { hasText: 'обжиг' }).filter({ has: page.getByRole('button', { name: 'Переименовать тег' }) }), 'Переименовать тег', 'Удалить тег'],
  ] as const) {
    await chip.hover();
    expect(await hits(chip.getByRole('button', { name: rename })), `карандаш «${rename}»`).toEqual([rename]);
    expect(await hits(chip.getByRole('button', { name: remove })), `крестик «${remove}»`).toEqual([remove]);
  }

  const label = page.locator('.group\\/label', { hasText: 'Мастерская' });
  await label.hover();
  await label.getByRole('button', { name: 'Переименовать метку' }).click();
  await page.getByLabel('Название метки').fill('Студия');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.group\\/label', { hasText: 'Студия' })).toBeVisible({ timeout: 15_000 });
});
