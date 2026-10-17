// MQ-7/MQ-8: панели над списком заметок на телефоне («Теги и метки», «Календарь и
// статистика») — по правилам телефона: строчные подписи, цели 44 px, без вложенных
// карточек и внутренней прокрутки.
import { expect, test, type Page } from '@playwright/test';
import { openVaultFromBanner, waitForNavigationSettled, shot, signInMobile, smallTargets, zenOff } from './harness';

async function saveNoteWithTag(page: Page, text: string, tag: string): Promise<void> {
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill(text);
  await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
  const finish = page.locator('[aria-labelledby="finish-modal-title"]');
  await expect(finish).toBeVisible({ timeout: 15_000 });
  const input = finish.getByLabel(/Добавить тег/);
  await input.fill(tag);
  await input.press('Enter');
  await finish.getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(finish).toBeHidden({ timeout: 20_000 });
  // Приёмка 0.10.0: после сохранения приложение само уходит по адресу; `goto`
  // спека в этом окне на WebKit ловит «interrupted by another navigation».
  await waitForNavigationSettled(page);
}

for (const [w, h] of [[360, 740], [390, 844]] as const) {
  test.describe(`MQ-7/8: панели архива на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('MQ-7: панель тегов — строчная подпись, цели ≥ 44 px, без моно-капса', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mq7-tags-${w}`);
      await saveNoteWithTag(page, 'Заметка про глину. Вторая фраза.', 'керамика');
      await page.goto('/archive');
      await openVaultFromBanner(page, account.password);
      await expect(page.getByText('Заметка про глину.').first()).toBeVisible({ timeout: 20_000 });

      await page.getByRole('button', { name: 'Ещё' }).click();
      await page.getByRole('button', { name: /Теги и метки/ }).click();
      const panel = page.getByTestId('archive-tags-panel');
      await expect(panel).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(500);

      const style = await panel.evaluate(el => {
        const all = Array.from(el.querySelectorAll<HTMLElement>('*'));
        return {
          upper: all.filter(e => getComputedStyle(e).textTransform === 'uppercase').length,
          mono: all.filter(e => e.childNodes.length > 0 && /mono/i.test(getComputedStyle(e).fontFamily) && (e.textContent ?? '').trim() !== '').length,
        };
      });
      expect(style, 'в панели тегов остался моно-капс').toEqual({ upper: 0, mono: 0 });
      const small = (await smallTargets(page)).filter(s => /керамика|Закрыть|сброс/i.test(s.label));
      expect(small, `цели меньше 44 px: ${JSON.stringify(small)}`).toEqual([]);
      await shot(page, `mq7-tags-panel-${w}`);
    });

    test('MQ-8: панель календаря плоская — без внутренней прокрутки, капса, вложенных карточек и плитки «0 минут»', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mq8-cal-${w}`);
      await saveNoteWithTag(page, 'Календарная заметка про глину. Вторая фраза.', 'глина');
      await page.goto('/archive');
      await openVaultFromBanner(page, account.password);
      await expect(page.getByText('Календарная заметка про глину.').first()).toBeVisible({ timeout: 20_000 });

      await page.getByRole('button', { name: 'Ещё' }).click();
      await page.getByRole('button', { name: /Календарь и статистика/ }).click();
      const panel = page.getByTestId('archive-calendar-panel');
      await expect(panel).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(800);

      const facts = await panel.evaluate(el => {
        const all = Array.from(el.querySelectorAll<HTMLElement>('*')).concat(el as HTMLElement);
        return {
          scrollers: all.filter(e => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1).length,
          upper: all.filter(e => getComputedStyle(e).textTransform === 'uppercase').length,
          nestedCards: all.filter(e => e !== el && parseFloat(getComputedStyle(e).borderTopWidth) > 0 && getComputedStyle(e).borderTopStyle === 'solid' && e.tagName === 'DIV').length,
          minutesTile: /\bмин/.test(el.textContent ?? ''),
        };
      });
      expect(facts, `панель календаря: ${JSON.stringify(facts)}`).toEqual({ scrollers: 0, upper: 0, nestedCards: 0, minutesTile: false });
      const close = panel.getByRole('button', { name: 'Закрыть' });
      expect((await close.boundingBox())!.width, '«×» уже 44 px').toBeGreaterThanOrEqual(44);
      await shot(page, `mq8-calendar-panel-${w}`);
    });
  });
}
