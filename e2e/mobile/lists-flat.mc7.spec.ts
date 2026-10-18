// MC-7: списки без полос и карточек-в-карточке. На /archive никто не рисует
// цветной левый край (метка остаётся подложкой), заголовок дня — одно слово-дата;
// на /me нет .rounded-2xl внутри .rounded-2xl. Десктоп эти проверки не касается.
import { expect, test, type Page } from '@playwright/test';
import { openVaultFromBanner, shot, signInMobile, zenOff, type Account } from './harness';

async function saveNote(page: Page, text: string, title: string): Promise<void> {
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill(text);
  await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
  const finish = page.getByRole('dialog').last();
  await expect(finish).toBeVisible({ timeout: 15_000 });
  const titleInput = finish.getByLabel(/Название/).first();
  if (await titleInput.isVisible().catch(() => false)) await titleInput.fill(title);
  await finish.getByRole('button', { name: /^Сохранить$/ }).click();
  // Барьер сохранения из 0.9.39: ждём, пока окно «Записано.» уйдёт, а не таймер.
  await expect(page.locator('[aria-labelledby="finish-modal-title"]'), 'окно завершения не закрылось — сохранение не дошло')
    .toBeHidden({ timeout: 20_000 });
}

async function toArchive(page: Page, account: Account): Promise<void> {
  await page.goto('/archive');
  await openVaultFromBanner(page, account.password);
}

for (const { w, h } of [{ w: 390, h: 844 }, { w: 360, h: 640 }]) {
  test.describe(`MC-7: плоские списки на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('в архиве нет левого акцентного края у заметки без метки, заголовок дня — как на десктопе', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mc7-flat-${w}`);
      await saveNote(page, 'Глина сохнет быстрее, чем кажется. Поэтому круг крутят медленно.', `Круг ${w}`);

      await toArchive(page, account);
      await shot(page, `mc7-archive-before-${w}`);

      // U-14 (решение владельца 2026-10-18, Q-2): заголовок дня — как на десктопе:
      // дата моно-капсом и счётчики «N заметок · M слов» (MC-7 их убирал).
      const header = page.locator('[data-testid="archive-day-header"]').first();
      await expect(header, 'заголовка дня нет').toBeVisible({ timeout: 15_000 });
      const headerText = (await header.textContent()) ?? '';
      expect(headerText, `в заголовке дня нет счётчиков: ${headerText}`).toMatch(/заметк/);
      expect(headerText, `в заголовке дня нет числа слов: ${headerText}`).toMatch(/слов/);

      const striped = await page.evaluate(() => {
        const bad: string[] = [];
        document.querySelectorAll<HTMLElement>('*').forEach(el => {
          const cs = getComputedStyle(el);
          const width = parseFloat(cs.borderLeftWidth);
          // U-34 (решение владельца 2026-10-18, Q-5): строка заметки — как на
          // десктопе, с прозрачной полосой border-l-2, которая окрашивается
          // цветом метки. У заметки без метки видимого края быть не должно:
          // ловим только непрозрачный цвет.
          if (cs.borderLeftColor === 'rgba(0, 0, 0, 0)' || cs.borderLeftColor === 'transparent') return;
          if (width > 1) bad.push(`${el.tagName}.${el.className.toString().slice(0, 60)}=${width}px ${cs.borderLeftColor}`);
        });
        return bad;
      });
      expect(striped, `цветной левый край остался: ${striped.join(' | ')}`).toEqual([]);

      await shot(page, `mc7-archive-${w}`);
    });

    test('в профиле нет карточки внутри карточки', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mc7-me-${w}`);
      await saveNote(page, 'Считал километры вдоль канала и не заметил, как стемнело.', `Канал ${w}`);

      await toArchive(page, account);
      await page.goto('/me');
      await expect(page.getByRole('heading', { name: 'Профиль' }).first(), 'профиль не открылся').toBeVisible({ timeout: 15_000 });
      await shot(page, `mc7-me-before-${w}`);

      const nested = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('.rounded-2xl'))
          // closest() считает и самого элемента, поэтому поднимаемся к родителю.
          .filter(el => el.parentElement?.closest('.rounded-2xl') != null)
          .map(el => `${el.tagName}.${el.className.toString().slice(0, 60)}`));
      expect(nested, `карточка внутри карточки: ${nested.join(' | ')}`).toEqual([]);

      await expect(page.getByText('Практика'), 'группы «Практика» нет').toBeVisible();
      await expect(page.getByText('Состояние'), 'группы «Состояние» нет').toBeVisible();
      await expect(page.getByRole('button', { name: /Написать сейчас/ }), 'кнопка «Написать сейчас» осталась').toHaveCount(0);

      await shot(page, `mc7-me-${w}`);
    });
  });
}
