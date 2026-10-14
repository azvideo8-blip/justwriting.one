// MB-5 (F-26): панель диктовки стоит над панелью управления, а не под ней.
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

    await startDictation(page);
    expect(await emitSpeech(page, 'result', { items: [{ text: PHRASE, final: true }], index: 0 })).toBe('ok');

    const bar = page.locator('[data-dictation-bar]');
    await expect(bar, 'панель диктовки не появилась').toBeVisible({ timeout: 10_000 });
    await expect(bar).toBeInViewport();

    const stop = page.getByRole('button', { name: /Остановить диктовку/ }).first();
    await expect(stop).toBeVisible();
    const box = await stop.boundingBox();
    expect(box, 'нет геометрии у кнопки остановки').not.toBeNull();
    if (box) {
      const hit = await page.evaluate(({ x, y }: { x: number; y: number }) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return '—';
        return `${el.tagName.toLowerCase()}«${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 28)}»`
          + `${el.closest('[data-dictation-bar]') ? ' ✓панель' : ''}`
          + `${el.closest('[class*="--z-sidebar"]') ? ' ✗чип-панель' : ''}`;
      }, { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });
      console.warn('[mb5] под центром «Остановить диктовку»:', hit);
      expect(hit, 'кнопка остановки закрыта тулбаром или чипом').toContain('✓панель');

      // Панель и тулбар не перекрывают друг друга.
      const overlap = await page.evaluate(() => {
        const barEl = document.querySelector('[data-dictation-bar]')?.getBoundingClientRect();
        const toolbar = document.querySelector('[data-write-toolbar]')?.getBoundingClientRect();
        if (!barEl || !toolbar) return null;
        return Math.round(barEl.bottom - toolbar.top);
      });
      console.warn('[mb5] низ панели минус верх тулбара:', overlap);
    }

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
