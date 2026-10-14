// MR-1: на телефоне прошлые диалоги возвращаются — ☰ открывает лист, «+» заводит новый.
// Проекты: Mobile Chrome (360) и Mobile Safari (390) — оба размера из тикета.
//
// До MR-2 поле ввода и «Отправить» перекрыты рядом персон (находка аудита),
// поэтому ход отправляется клавишей ввода, как в mb6-спеке, — это способ получить
// ответ заглушки, а не обход проверки геометрии.
import { expect, test } from '@playwright/test';
import { fullyInViewport, grantAiConsent, shot, signInMobile, unlockVaultIfAsked } from './harness';

const marker = () => `МР1-${Date.now().toString(36)}`;

test.describe('MR-1: лист диалогов на телефоне', () => {
  test('диалог находится в ☰, открывается по тапу и «Новый диалог» даёт пустой чат', async ({ page }) => {
    // signInMobile, а не login: он снимает окна первого входа, иначе окно
    // «Синхронизация с облаком» перекрывает весь экран и клик не проходит.
    const acc = await signInMobile(page, 'mr1-list');
    // Согласие на ИИ только после первого входа: до него строки public.users нет.
    grantAiConsent(acc.uid);
    await page.reload();
    await unlockVaultIfAsked(page, acc.password);

    const text = marker();
    await page.goto('/ai');
    const composer = page.locator('textarea').last();
    await composer.waitFor({ state: 'visible', timeout: 30_000 });
    await composer.fill(text);
    await composer.press('Enter');
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 40_000 });
    // Диалог пишется в базу не синхронно с ответом: без паузы перезагрузка
    // иногда успевает раньше записи.
    await page.waitForTimeout(3000);

    await page.reload();
    await unlockVaultIfAsked(page, acc.password);
    await page.goto('/ai');

    await page.getByRole('button', { name: 'Диалоги' }).click();
    // Заголовок диалога строит модель из ответа, поэтому ищем по тексту реплики:
    // поле листа ищет и по заголовку, и по первому сообщению.
    const search = page.getByRole('textbox', { name: /Поиск по диалогам/ });
    await search.fill(text);
    const rows = page.getByTestId('dialogue-row');
    await expect(rows, 'поиск по тексту реплики дал не одну строку').toHaveCount(1, { timeout: 15_000 });
    const row = rows.first();
    // Лист выезжает пружиной: разовый замер ловит середину анимации.
    await expect.poll(() => fullyInViewport(row), { timeout: 10_000, message: 'строка листа не влезает в экран' })
      .toBe(true);
    // Геометрия кнопок шапки — здесь: после выбора диалога чат прокручивается
    // вниз, и шапка уходит за верхний край.
    const fresh = page.getByRole('button', { name: 'Новый диалог' });
    await expect.poll(() => fullyInViewport(fresh), { timeout: 10_000, message: '«Новый диалог» не влезает в экран' })
      .toBe(true);
    await expect.poll(() => fullyInViewport(page.getByRole('button', { name: 'Диалоги' })), { timeout: 10_000 })
      .toBe(true);
    await shot(page, 'mr1-dialogue-list');

    await row.click();
    await expect(page.getByText(text).first(), 'после выбора строки реплика не на экране')
      .toBeVisible({ timeout: 15_000 });

    await fresh.click();
    await expect(page.getByText(text), 'после «Новый диалог» прежний текст остался на экране')
      .toHaveCount(0, { timeout: 15_000 });
    await shot(page, 'mr1-new-dialogue');
  });
});
