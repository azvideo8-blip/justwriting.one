// UG-2: пересъём устаревших десктопных кадров руководства.
//
// Это не проверка, а станок: спек запускается по флагу JW_UG_SHOTS=1 и пишет
// png в JW_UG_SHOT_DIR (по умолчанию scripts/stand/ug2-shots — НЕ в public/:
// кадр попадает в руководство только после того, как его посмотрели глазами и
// сверили с подписью). Нужен локальный стенд (scripts/stand/up.sh): аккаунт
// заводится на каждый прогон через админ-API GoTrue, тексты синтетические.
//
//   JW_UG_SHOTS=1 npx playwright test -c playwright.docs.config.ts
//
// Кадров восемь: s-privacy (окно согласия), e-unlock (разблокировка сейфа),
// e-vault и a-settings (раздел «Безопасность»), n-export-menu (меню экспорта
// в читалке), e-forgot (сброс пароля на входе), a-chat-empty (пустой диалог)
// и s-set-password (пароль по приглашению).
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createUser, generateLink } from './stand';
import {
  autoHandlers, clearDeviceKeyCache, dismissFirstLoginDialogs, grantAiConsent,
  unlockVaultIfAsked, waitForNavigationSettled, zenOff,
} from './mobile/harness';

const OUT = process.env.JW_UG_SHOT_DIR ?? resolve('scripts/stand/ug2-shots');
/** Та же тёмная тема, что на прежних снимках руководства. */
const THEME = process.env.JW_UG_THEME ?? 'amethyst';

const NOTE_TEXT = 'Сегодня прошлась шесть километров вдоль набережной. Ветер был резкий, '
  + 'но ноги шли легко, и впервые за неделю я легла до полуночи.\n\n'
  + 'Кофе остыл, зато дождь кончился ровно тогда, когда мы вышли гулять. '
  + 'Хочу вернуться к глине и кругу — не хватает двух вечеров в неделю.';
const NOTE_TITLE = 'Прогулка вдоль набережной';

async function frame(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(450);
  const file = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.warn(`[ug2] ${file}`);
}

/** Прокрутить окно согласия к низу — туда, где галочка и блок про ИИ. */
async function scrollConsentDown(page: Page): Promise<void> {
  await page.getByRole('dialog').last().evaluate((el) => {
    const box = el.querySelector<HTMLElement>('[class*="overflow-y"], [class*="overflow-auto"]') ?? el;
    box.scrollTop = box.scrollHeight;
  }).catch(() => {});
}

/** Поставить блок с нужной строкой на верх кадра: в кадр не должно лезти чужое. */
async function scrollToText(page: Page, text: string, offset = 40): Promise<void> {
  const el = page.getByText(text, { exact: true }).first();
  if (!(await el.isVisible().catch(() => false))) {
    console.warn(`[ug2] прокрутка: «${text}» не найдено на экране`);
    return;
  }
  await el.evaluate((node, top) => {
    window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - (top as number));
  }, offset);
  await page.waitForTimeout(400);
}

/** Убрать рамку фокуса: на кадре она выглядит как указание на несуществующую кнопку. */
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

/** Сейф, которого ещё нет: заводим его в разделе «Шифрование». */
async function ensureVault(page: Page, password: string): Promise<void> {
  await page.goto('/settings#security-section');
  await page.waitForTimeout(1_500);
  const setup = page.getByLabel('Пароль от аккаунта').first();
  if (!(await setup.isVisible().catch(() => false))) {
    await unlockVaultIfAsked(page, password, 3_000);
    return;
  }
  await setup.fill(password);
  await page.getByLabel('Подтверди пароль').first().fill(password);
  await page.getByRole('button', { name: 'Включить шифрование' }).first().click();
  await page.waitForTimeout(4_000);
  // Следом приезжает окно кода восстановления: здесь мы его просто снимаем,
  // чтобы оно не закрыло собой следующий кадр.
  await dismissFirstLoginDialogs(page, true, 20_000);
}

test('UG-2: десктопные кадры руководства', async ({ page }) => {
  test.skip(!process.env.JW_UG_SHOTS, 'только по JW_UG_SHOTS=1');
  test.setTimeout(420_000);
  await page.addInitScript((theme: string) => {
    try { localStorage.setItem('app-theme', JSON.stringify(theme)); } catch { /* приватный режим */ }
  }, THEME);
  await zenOff(page);
  page.on('pageerror', e => console.warn('[ug2 pageerror]', String(e).slice(0, 160)));

  const account = await createUser('ug2');
  await autoHandlers(page, account.password, { autoUnlock: false });

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.locator('input[type="password"]').press('Enter');
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 90_000 });
  await waitForNavigationSettled(page);

  // 1. Окно согласия — до того, как его снимет автообработчик.
  const consent = page.getByRole('dialog').filter({ hasText: /Обязательно/ }).last();
  if (!(await consent.waitFor({ state: 'visible', timeout: 25_000 }).then(() => true, () => false))) {
    console.warn('[ug2] s-privacy: окно согласия не приехало — снимаем то, что на экране');
  } else {
    await scrollConsentDown(page);
  }
  await blur(page);
  await frame(page, 's-privacy');
  await dismissFirstLoginDialogs(page, true, 45_000);

  // 2–3. Раздел «Безопасность»: сейф и блок про ИИ. Согласие на ИИ и поиск по
  // смыслу включаются по-настоящему (строка в базе + та же кнопка в интерфейсе),
  // иначе кадр показывает «не предоставлено» там, где текст рядом описывает
  // включённое состояние.
  grantAiConsent(account.uid);
  await ensureVault(page, account.password);
  await page.goto('/settings#security-section');
  await page.waitForTimeout(2_000);
  await unlockVaultIfAsked(page, account.password, 3_000);
  const searchOn = page.getByRole('button', { name: 'Включить поиск по смыслу' }).first();
  if (await searchOn.isVisible().catch(() => false)) {
    await searchOn.click();
    await page.waitForTimeout(1_500);
    await dismissFirstLoginDialogs(page, true, 12_000);
  }
  await scrollToText(page, 'Сейф разблокирован');
  await frame(page, 'e-vault');
  await page.goto('/settings#security-section');
  await page.waitForTimeout(1_500);
  await scrollToText(page, 'Искусственный интеллект и приватность');
  await frame(page, 'a-settings');

  // 4. Читалка с открытым меню экспорта.
  await page.goto('/');
  const ta = page.locator('textarea').first();
  await ta.waitFor({ timeout: 30_000 });
  await ta.click();
  await ta.fill(NOTE_TEXT);
  await page.waitForTimeout(3_000);
  // Заметкой запись становится только после «Завершить сессию» (⌘/Ctrl+Enter)
  // и «Сохранить» в окне итогов: «Сохраню позже» — это отказ от записи.
  await ta.press('ControlOrMeta+Enter');
  const sheet = page.getByText(/^Записано/).first();
  if (await sheet.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) {
    await page.getByPlaceholder('Заголовок').first().fill(NOTE_TITLE).catch(() => {});
    // По роли кнопка не ищется: под окном лежит иконка с тем же aria-label, и
    // Playwright бьётся в неё. Берём текстовую надпись внутри самой кнопки.
    await page.getByText('Сохранить', { exact: true }).last().click({ timeout: 8_000 }).catch(async () => {
      await page.getByText('Сохранить', { exact: true }).last().dispatchEvent('click');
    });
  } else {
    console.warn('[ug2] окно итогов с «Записано …» не приехало');
  }
  await page.waitForTimeout(3_000);
  await page.goto('/archive');
  await page.waitForTimeout(2_500);
  // Открывает читалку клик по строке-отрывку: по заголовку — переименование.
  const row = page.locator('p.cursor-pointer', { hasText: 'ноги шли легко' }).first();
  if (!(await row.isVisible().catch(() => false))) {
    console.warn('[ug2] n-export-menu: заметка не появилась в архиве');
  } else {
    await row.click();
    const exportBtn = page.locator('button[title="Экспортировать"]').first();
    if (await exportBtn.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) {
      await exportBtn.click();
      await frame(page, 'n-export-menu');
    } else {
      console.warn('[ug2] n-export-menu: кнопки «Экспортировать» в читалке не видно');
    }
  }

  // 5. Пустой диалог: как он выглядит сейчас (подсказки стартового экрана).
  // Снимаем ДО запертого сейфа — иначе окно разблокировки встанет поверх.
  await page.goto('/ai');
  await page.waitForTimeout(3_000);
  await frame(page, 'a-chat-empty');

  // 6. Запертый сейф: окно разблокировки поднимается само при заходе в архив.
  await clearDeviceKeyCache(page, account.uid);
  await page.goto('/archive');
  await page.reload();
  const unlock = page.getByRole('dialog').filter({ hasText: /Разблокировать шифрование/ }).last();
  if (await unlock.waitFor({ state: 'visible', timeout: 25_000 }).then(() => true, () => false)) {
    await frame(page, 'e-unlock');
  } else {
    console.warn('[ug2] e-unlock: окно разблокировки не приехало');
  }
});

test('UG-2: страница пароля по приглашению', async ({ page }) => {
  test.skip(!process.env.JW_UG_SHOTS, 'только по JW_UG_SHOTS=1');
  test.setTimeout(120_000);
  await page.addInitScript((theme: string) => {
    try { localStorage.setItem('app-theme', JSON.stringify(theme)); } catch { /* приватный режим */ }
  }, THEME);
  // Логин в шапке шага — адрес из приглашения: берём выдуманный, а не служебный
  // стендовый, чтобы в руководдении не светился stand.test.
  const token = await generateLink('invite', 'primer@pochta.ru');
  await page.goto(`/reset-password?token_hash=${token}&type=invite`);
  await page.getByRole('heading', { name: 'Добро пожаловать в justwriting' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('checkbox', { name: /Обязательно/ }).check();
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByRole('heading', { name: 'Придумай пароль' }).waitFor({ timeout: 20_000 });
  // Поля оставляем пустыми: в кадре должны быть видны их подписи.
  await frame(page, 's-set-password');
});

test('UG-2: сброс пароля на входе', async ({ page }) => {
  test.skip(!process.env.JW_UG_SHOTS, 'только по JW_UG_SHOTS=1');
  test.setTimeout(120_000);
  await page.addInitScript((theme: string) => {
    try { localStorage.setItem('app-theme', JSON.stringify(theme)); } catch { /* приватный режим */ }
  }, THEME);
  await page.goto('/login');
  await page.locator('input[type="email"]').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Забыли пароль?' }).first().click();
  await expect(page.getByText('Сброс пароля')).toBeVisible({ timeout: 15_000 });
  await frame(page, 'e-forgot');
});
