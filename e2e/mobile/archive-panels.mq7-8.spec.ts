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

    test('MQ-7: панель тегов — метки моно-капсом ≥ 12 px (U-9), цели ≥ 44 px', async ({ page }) => {
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

      // U-9 (решение владельца 2026-10-18): метка раздела — моно-капс, как на
      // десктопе, но на телефоне не мельче 12 px; моно — только у меток.
      const style = await panel.evaluate(el => {
        const all = Array.from(el.querySelectorAll<HTMLElement>('*'));
        const texty = (e: HTMLElement) => e.childNodes.length > 0 && (e.textContent ?? '').trim() !== '';
        return {
          smallUpper: all.filter(e => texty(e) && getComputedStyle(e).textTransform === 'uppercase' && parseFloat(getComputedStyle(e).fontSize) < 12).length,
          monoNotLabel: all.filter(e => texty(e) && /mono/i.test(getComputedStyle(e).fontFamily) && getComputedStyle(e).textTransform !== 'uppercase').length,
        };
      });
      expect(style, 'метки панели тегов не по правилу U-9').toEqual({ smallUpper: 0, monoNotLabel: 0 });
      const small = (await smallTargets(page)).filter(s => /керамика|Закрыть|сброс/i.test(s.label));
      expect(small, `цели меньше 44 px: ${JSON.stringify(small)}`).toEqual([]);
      await shot(page, `mq7-tags-panel-${w}`);
    });

    test('MQ-8: панель календаря плоская — без внутренней прокрутки, вложенных карточек и плитки «0 минут»; капс — только метки ≥ 12 px', async ({ page }) => {
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
          // U-9/U-14: капс разрешён меткам и заголовкам дня — не мельче 12 px.
          smallUpper: all.filter(e => getComputedStyle(e).textTransform === 'uppercase' && (e.textContent ?? '').trim() !== '' && parseFloat(getComputedStyle(e).fontSize) < 12).length,
          nestedCards: all.filter(e => e !== el && parseFloat(getComputedStyle(e).borderTopWidth) > 0 && getComputedStyle(e).borderTopStyle === 'solid' && e.tagName === 'DIV').length,
          minutesTile: /\bмин/.test(el.textContent ?? ''),
        };
      });
      expect(facts, `панель календаря: ${JSON.stringify(facts)}`).toEqual({ scrollers: 0, smallUpper: 0, nestedCards: 0, minutesTile: false });
      const close = panel.getByRole('button', { name: 'Закрыть' });
      expect((await close.boundingBox())!.width, '«×» уже 44 px').toBeGreaterThanOrEqual(44);
      await shot(page, `mq8-calendar-panel-${w}`);
    });
  });
}
