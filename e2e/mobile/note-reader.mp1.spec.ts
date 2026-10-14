// MP-1: заметка на телефоне открывается полноэкранной читалкой.
//
// Проверяется геометрия (читалка = весь вьюпорт, нижняя панель под ней),
// отсутствие метаданных в теле, «ⓘ» с датой и тегами (тег, добавленный там,
// переживает закрытие и повторное открытие), возврат к списку по «‹ Заметки» и
// по аппаратной «назад», и лист «⋯» с «Изменить» в редактор.
import { expect, test, type Page } from '@playwright/test';
import { fullyInViewport, openVaultFromBanner, shot, signInMobile, zenOff, type Account } from './harness';

const SIZES = [{ w: 360, h: 640 }, { w: 390, h: 844 }];

/** Сохранение заметки через окно завершения. Обязан ждать закрытия окна: «goto»
 *  сразу после «Сохранить» обрывает шифрование и запись (CI 0.9.39). */
async function saveNote(page: Page, text: string, title: string): Promise<void> {
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill(text);
  await page.getByRole('button', { name: /^Готово$/ }).click();
  const finish = page.getByRole('dialog').last();
  await expect(finish).toBeVisible({ timeout: 15_000 });
  const titleInput = finish.getByLabel(/Название/).first();
  if (await titleInput.isVisible().catch(() => false)) await titleInput.fill(title);
  await finish.getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(page.locator('[aria-labelledby="finish-modal-title"]'), 'окно завершения не закрылось — сохранение не дошло')
    .toBeHidden({ timeout: 20_000 });
}

/** Из списка — в читалку. Возвращает читалку; панель сейфа открыта, если она была заперта. */
async function openReaderFromList(page: Page, account: Account, title: string) {
  await page.goto('/archive');
  await openVaultFromBanner(page, account.password);
  const row = page.getByText(title).first();
  await expect(row, 'заметка не появилась в архиве').toBeVisible({ timeout: 20_000 });
  await row.click();
  const reader = page.getByRole('dialog', { name: title }).first();
  await expect(reader, 'тап по строке не открыл читалку').toBeVisible({ timeout: 15_000 });
  return reader;
}

for (const { w, h } of SIZES) {
  test.describe(`MP-1: читалка заметки на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('читалка закрывает весь вьюпорт, панель навигации под ней, текст начинается высоко', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mp1-full-${w}`);
      const title = `Читалка ${w}`;
      await saveNote(page, 'Глина сохнет быстрее, чем кажется. Поэтому круг крутят медленно, а глазурь берут ровным слоем.', title);

      await page.goto('/archive');
      await openVaultFromBanner(page, account.password);
      await shot(page, `mp1-before-list-${w}`);

      const reader = await openReaderFromList(page, account, title);

      // Лист приезжает снизу за 280 мс: мерить геометрию по первому кадру —
      // значит поймать анимацию (в первом прогоне y=242 вместо 0).
      await expect.poll(async () => {
        const b = await reader.boundingBox();
        return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
      }, { timeout: 10_000, message: 'читалка не заняла весь вьюпорт (портал в body, `inset-0`)' })
        .toEqual({ x: 0, y: 0, w, h });

      // Нижняя панель не видна: нижняя точка экрана принадлежит читалке.
      const under = await page.evaluate((point) => {
        const el = document.elementFromPoint(point.x, point.y);
        return { inReader: !!el?.closest('[role="dialog"]'), tag: el ? `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60) : 'нет элемента' };
      }, { x: Math.round(w / 2), y: h - 8 });
      expect(under.inReader, `под читалкой виден ${under.tag}`).toBe(true);

      const text = reader.getByText(/Глина сохнет/).first();
      const textBox = await text.boundingBox();
      expect(textBox, 'в теле нет текста').not.toBeNull();
      expect(textBox!.y, `текст начинается с y=${textBox!.y}`).toBeLessThan(200);
      expect(await fullyInViewport(text), 'текст за экраном').toBe(true);

      // Метаданных в теле нет.
      await expect(reader.getByText(/мин чтения/), 'в теле осталось время чтения').toHaveCount(0);
      await expect(reader.getByText('Назначить метку'), 'в теле осталась метка').toHaveCount(0);
      await expect(reader.getByText('Проанализировать'), 'в теле остался разбор').toHaveCount(0);
      await shot(page, `mp1-reader-${w}`);
    });

    test('«ⓘ» с датой и тегами: тег, добавленный там, остаётся после перезахода', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mp1-info-${w}`);
      // Заголовок заметки не должен содержать «Инфо»: иначе имя окна «ⓘ»
      // (`getByRole({name})` — подстрока) спорит с aria-label читалки.
      const title = `Обжиг в печи ${w}`;
      await saveNote(page, 'Один абзац про обжиг, чтобы было что читать в заметке.', title);

      const reader = await openReaderFromList(page, account, title);
      await reader.getByRole('button', { name: 'Инфо' }).click();
      const info = page.getByRole('dialog', { name: 'Инфо', exact: true });
      await expect(info, '«ⓘ» не открылось').toBeVisible({ timeout: 15_000 });
      await expect(info.getByText(/\d+ \S+ 20\d\d/).first(), 'в «ⓘ» нет даты').toBeVisible();
      await shot(page, `mp1-info-${w}`);

      await info.getByRole('button', { name: /Добавить тег|\+/ }).first().click();
      const tagInput = info.locator('input').last();
      await tagInput.fill('обжиг');
      await tagInput.press('Enter');
      await expect(info.getByText('обжиг').first(), 'тег не добавился').toBeVisible();

      await info.getByRole('button', { name: /^Закрыть$/ }).click();
      await expect(info).toBeHidden({ timeout: 10_000 });

      await reader.getByRole('button', { name: 'Инфо' }).click();
      const reopened = page.getByRole('dialog', { name: 'Инфо', exact: true });
      await expect(reopened, '«ⓘ» не открылось снова').toBeVisible({ timeout: 15_000 });
      await expect(reopened.getByText('обжиг').first(), 'тег пропал после закрытия').toBeVisible();
    });

    test('«‹ Заметки» возвращает к списку, «назад» — тоже', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mp1-back-${w}`);
      const title = `Назад ${w}`;
      await saveNote(page, 'Заметка про возврат к списку.', title);

      const reader = await openReaderFromList(page, account, title);
      await reader.getByRole('button', { name: /Заметки/ }).click();
      await expect(reader, '«‹ Заметки» не закрыла читалку').toBeHidden({ timeout: 15_000 });
      await expect(page.getByText(title).first(), 'список не вернулся').toBeVisible({ timeout: 15_000 });

      await page.getByText(title).first().click();
      await expect(reader).toBeVisible({ timeout: 15_000 });
      await page.goBack();
      await expect(reader, 'аппаратная «назад» не закрыла читалку').toBeHidden({ timeout: 15_000 });
      await expect(page.getByText(title).first(), '«назад» ушла не в список').toBeVisible({ timeout: 15_000 });
      expect(new URL(page.url()).pathname).toBe('/archive');
    });

    test('«⋯» открывает лист действий с «Изменить» в редактор', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mp1-actions-${w}`);
      const title = `Действия ${w}`;
      await saveNote(page, 'Заметка про лист действий.', title);

      const reader = await openReaderFromList(page, account, title);
      await reader.getByRole('button', { name: 'Действия с заметкой' }).click();
      const sheet = page.getByRole('dialog', { name: 'Действия с заметкой' });
      await expect(sheet, '«⋯» не открыла лист действий').toBeVisible({ timeout: 15_000 });
      await expect(sheet.getByRole('button', { name: 'Изменить', exact: true }), 'в листе нет «Изменить»').toBeVisible();
      await expect(sheet.getByRole('button', { name: /Удалить заметку/ }), 'в листе нет удаления').toBeVisible();
      await expect(sheet.getByRole('button', { name: /Загрузить на облако|Скачать на это устройство|Удалить локальную копию|Удалить облачную копию/ })).toHaveCount(0);
      await shot(page, `mp1-actions-${w}`);

      await sheet.getByRole('button', { name: 'Изменить', exact: true }).click();
      await page.waitForURL(url => !url.pathname.startsWith('/archive'), { timeout: 20_000 });
      await expect(page.locator('textarea').first(), '«Изменить» не привела в редактор').toBeVisible({ timeout: 20_000 });
    });
  });
}
