// MB-5 (F-26): панель диктовки стоит над панелью управления, а не под ней.
// MF-4: на телефоне запись идёт в самой панели письма — карточки нет, высота
// панели в записи та же, что без неё, «■» не закрыт ничем.
// Движок — заглушка с последовательностями событий Chrome Android (из G-dictation
// аудита Fable), не живое распознавание.
import { expect, test } from '@playwright/test';
import {
  DICTATION_ENGINE, emitSpeech, shot, signInMobile, startDictation, zenOff,
} from './harness';

test.use({ viewport: { width: 360, height: 640 } });

const PHRASE = 'Проверка панели диктовки над тулбаром';

test.describe('MB-5: панель диктовки над панелью инструментов', () => {
  test('панель видно, «Остановить диктовку» кликабельна, текст доходит до заметки', async ({ page }) => {
    await page.addInitScript(DICTATION_ENGINE);
    await zenOff(page);
    await signInMobile(page, 'mb5-dict');

    // MR-6 (направление A): редактор открыт сразу, «Начать» и лист режима не нужны.
    await page.goto('/');
    const editor = page.locator('textarea').first();
    await editor.waitFor({ state: 'visible', timeout: 30_000 });
    await editor.click();
    await editor.fill('Начало. ');

    const toolbar = page.locator('[data-write-toolbar]');
    const idleHeight = (await toolbar.boundingBox())!.height;
    await startDictation(page);
    expect(await emitSpeech(page, 'result', { items: [{ text: PHRASE, final: true }], index: 0 })).toBe('ok');

    const row = toolbar.locator('[data-dictation-row]');
    await expect(row, 'панель не перешла в строку записи').toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-dictation-bar]'), 'на телефоне осталась карточка записи').toHaveCount(0);
    const recHeight = (await toolbar.boundingBox())!.height;
    expect(Math.abs(recHeight - idleHeight), `высота панели ${idleHeight} → ${recHeight}`).toBeLessThanOrEqual(1);

    const stop = row.getByRole('button', { name: /Остановить диктовку/ });
    await expect(stop).toBeVisible();
    const box = (await stop.boundingBox())!;
    const hit = await page.evaluate(({ x, y }: { x: number; y: number }) =>
      !!document.elementFromPoint(x, y)?.closest('[data-dictation-row]'),
    { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });
    expect(hit, '«■» закрыт чем-то').toBe(true);

    await shot(page, 'mb5-dictation-panel-360');

    await stop.click();
    await expect
      .poll(async () => await editor.inputValue(), { timeout: 30_000 })
      .toContain('Проверка');
    // Текст пришёл в ту же заметку: редактор не менял документ.
    expect(await page.evaluate(() => location.pathname)).toBe('/');
    await shot(page, 'mb5-dictation-after-stop-360');
  });
});
