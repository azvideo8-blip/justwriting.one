// UG-3: снимки для мобильного руководства. Не проверка — спек запускается по
// флагу JW_UG_SHOTS=1 и пишет png прямо в public/docs/mobile/img (папка
// переопределяется JW_UG_SHOT_DIR). 390×844, обе темы, синтетические заметки:
// ни одной строки из настоящего архива.
//
//   JW_UG_SHOTS=1 npx playwright test -c playwright.mobile.config.ts e2e/mobile/docs-shots.ug3.spec.ts --project="Mobile Chrome"
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DICTATION_ENGINE, signInMobile, zenOff } from './harness';

const OUT = process.env.JW_UG_SHOT_DIR ?? resolve('public/docs/mobile/img');
const THEMES = (process.env.JW_UG_THEMES ?? 'notion,amethyst').split(',');
const SIZES = (process.env.JW_UG_SIZES ?? '390x844').split(',').map(s => s.split('x').map(Number) as [number, number]);

const NOTE_A = 'Собрали релиз в шесть вечера. Кофе остыл, зато дождь кончился ровно тогда, когда мы вышли гулять.';
const NOTE_B = 'Разговор про глину и круг: хочется вернуться к гончарному делу, но не хватает двух вечеров в неделю.';
const NOTE_C = 'Позвонил старый знакомый. Вспомнили, как мерзли на платформе и делили один пакет на двоих.';

/** Каждый кадр — в своём try/catch: не снял один экран, так снимешь остальные. */
async function step(page: Page, theme: string, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    await shoot(page, name, theme);
  } catch (e) {
    console.warn(`[ug-shots] ${name}: пропущено — ${String(e).split('\n')[0]?.slice(0, 140)}`);
  }
}

/**
 * Перед каждым кадром — чистый лист: закрыть висящие листы и окна и зайти на
 * нужный маршрут. Иначе один неснятый кадр блокирует кликами всё остальное.
 */
async function reset(page: Page, path: string): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const dlg = page.getByRole('dialog').last();
    if (!(await dlg.isVisible().catch(() => false))) break;
    const btn = dlg.getByRole('button', { name: /^(Закрыть|Отмена|Назад|Готово|Понятно|Продолжить)$/ }).first();
    if (!(await btn.click({ timeout: 1_500 }).then(() => true, () => false))) break;
    await page.waitForTimeout(280);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.goto(path);
  await page.waitForTimeout(1_200);
}

/**
 * Идентификаторы тем в приложении — `notion` (светлая) и `amethyst` (тёмная).
 * В файлы пишем человеческие суффиксы: иначе кадр с неизвестным id молча
 * снимается в теме по умолчанию, и «обе темы» на поверку оказываются одной.
 */
const THEME_SUFFIX: Record<string, string> = { notion: 'light', amethyst: 'dark' };

async function shoot(page: Page, name: string, theme: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const file = resolve(OUT, `${name}-${THEME_SUFFIX[theme] ?? theme}.png`);
  await page.waitForTimeout(420);
  await page.screenshot({ path: file });
  console.warn(`[ug-shots] ${file}`);
}

/** Панели на телефоне закрываются жестом «назад» или кнопкой — жмём кнопку. */
async function closeTopSheet(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const dlg = page.getByRole('dialog').last();
    if (!(await dlg.isVisible().catch(() => false))) return;
    const btn = dlg.getByRole('button', { name: /^(Закрыть|Отмена|Назад|Готово)$/ }).first();
    if (!(await btn.click({ timeout: 1_500 }).then(() => true, () => false))) return;
    await page.waitForTimeout(320);
  }
}

for (const [width, height] of SIZES) {
  for (const theme of THEMES) {
    test.describe(`UG-3 снимки ${theme} ${width}×${height}`, () => {
      test.skip(!process.env.JW_UG_SHOTS, 'только по JW_UG_SHOTS=1');
      test.use({ viewport: { width, height } });

      test(`экраны мобильного руководства (${theme})`, async ({ page }) => {
        test.setTimeout(360_000);
        await page.addInitScript(DICTATION_ENGINE);
        await zenOff(page);

        // 1. Гостевой вход (N-1) — отдельный кадр до всякого аккаунта.
        await step(page, theme, 'login', async () => {
          await page.goto('/login');
          await page.evaluate(t => localStorage.setItem('app-theme', JSON.stringify(t)), theme);
          await page.reload();
          await page.locator('input[type="email"]').first().waitFor({ timeout: 30_000 });
        });

        const account = await signInMobile(page, `ug-${theme}`);
        await page.evaluate(([t, uid]) => {
          localStorage.setItem('app-theme', JSON.stringify(t));
          (window as unknown as { __jwUid: string }).__jwUid = String(uid);
        }, [theme, account.uid] as const);
        await page.reload();
        await page.locator('textarea').first().waitFor({ timeout: 40_000 });

        const toolbar = page.locator('[data-write-toolbar]');
        const bar = (name: RegExp) => toolbar.getByRole('button', { name }).first();

        await step(page, theme, 'write-idle', async () => {
          await page.goto('/');
          await page.locator('textarea').first().waitFor({ timeout: 20_000 });
        });

        await step(page, theme, 'write-running', async () => {
          await page.locator('textarea').first().click();
          await page.locator('textarea').first().fill(NOTE_A);
        });

        await step(page, theme, 'session-sheet', async () => {
          await bar(/Режим сессии|Свободный поток|Обычный/).click();
          await page.getByRole('dialog').last().waitFor({ timeout: 6_000 });
        });
        await closeTopSheet(page);

        await step(page, theme, 'dictation', async () => {
          await bar(/диктовк|микрофо|Голос/i).click();
          await page.waitForTimeout(1_600);
        });
        // «Записано.» — окно итогов после «Сохранить» в панели письма. Снимается
        // ДО того, как мы его подтвердим: тот же путь, что у MQ-7.
        await step(page, theme, 'saved', async () => {
          await reset(page, '/');
          const ta = page.locator('textarea').first();
          await ta.waitFor({ timeout: 20_000 });
          await ta.click();
          await ta.fill(NOTE_A);
          await page.waitForTimeout(400);
          await bar(/^Сохранить$/).click();
          await page.locator('[aria-labelledby="finish-modal-title"]').waitFor({ timeout: 15_000 });
        });
        await step(page, theme, 'saved-confirm', async () => {
          const finish = page.locator('[aria-labelledby="finish-modal-title"]');
          await finish.getByRole('button', { name: /^Сохранить$/ }).click();
          await finish.waitFor({ state: 'hidden', timeout: 20_000 });
        });

        // Заметки заводятся через интерфейс: напечатал — «Сохранить» в панели,
        // «Сохранить» в окне итогов. Так в кадре настоящий список, а не строки,
        // подложенные из-под приложения.
        // NOTE_A уже сохранена шагом «Записано.» — досаживаем остальные две.
        // У первой из них есть тег: иначе панель «Теги и метки» не о чем показывать.
        for (const [i, text] of [NOTE_B, NOTE_C].entries()) {
          await step(page, theme, `seed-${text.slice(0, 4)}`, async () => {
            await reset(page, '/');
            const ta = page.locator('textarea').first();
            await ta.waitFor({ timeout: 20_000 });
            await ta.click();
            await ta.fill(text);
            await page.waitForTimeout(400);
            await bar(/^Сохранить$/).click();
            const finish = page.locator('[aria-labelledby="finish-modal-title"]');
            await finish.waitFor({ timeout: 15_000 });
            if (i === 0) {
              const input = finish.getByLabel(/Добавить тег/);
              await input.fill('глина');
              await input.press('Enter');
              await page.waitForTimeout(400);
            }
            await finish.getByRole('button', { name: /^Сохранить$/ }).click();
            await finish.waitFor({ state: 'hidden', timeout: 20_000 });
          });
        }

        await step(page, theme, 'notes-list', async () => {
          await reset(page, '/archive');
          await page.waitForTimeout(1_200);
        });

        await step(page, theme, 'notes-grid', async () => {
          await page.getByRole('button', { name: 'Ещё' }).click();
          const sheet = page.getByRole('dialog').filter({ hasText: 'Вид' }).first();
          await sheet.getByRole('button', { name: 'Сетка' }).click();
          await sheet.getByRole('button', { name: 'Закрыть' }).click();
          await page.locator('.archive-grid-two-col').first().waitFor({ timeout: 15_000 });
        });
        await step(page, theme, 'notes-list-back', async () => {
          await page.getByRole('button', { name: 'Ещё' }).click();
          const sheet = page.getByRole('dialog').filter({ hasText: 'Вид' }).first();
          await sheet.getByRole('button', { name: 'Список' }).click();
          await sheet.getByRole('button', { name: 'Закрыть' }).click();
          await page.waitForTimeout(600);
          await shoot(page, 'notes-list', theme);
        });

        await step(page, theme, 'tags-panel', async () => {
          await page.getByRole('button', { name: 'Ещё' }).click();
          await page.getByRole('button', { name: /Теги и метки/ }).click();
          await page.getByTestId('archive-tags-panel').waitFor({ timeout: 8_000 });
          await page.waitForTimeout(500);
        });
        await closeTopSheet(page);

        await step(page, theme, 'calendar-panel', async () => {
          await page.getByRole('button', { name: 'Ещё' }).click();
          await page.getByRole('button', { name: /Календарь и статистика/ }).click();
          await page.getByTestId('archive-calendar-panel').waitFor({ timeout: 8_000 });
          await page.waitForTimeout(700);
        });
        await closeTopSheet(page);

        await step(page, theme, 'reader', async () => {
          // На телефоне тап по строке несёт весь ряд (MR-9): берём заголовок.
          await page.getByText('Собрали релиз').first().click();
          await page.getByRole('dialog').last().waitFor({ timeout: 8_000 });
        });

        await step(page, theme, 'reader-info', async () => {
          await page.getByRole('button', { name: /^Инфо$/ }).first().click();
          await page.waitForTimeout(900);
        });
        await closeTopSheet(page);

        await step(page, theme, 'note-actions', async () => {
          // Лист действий живёт в читалке: открываем её заново, чтобы кадр не
          // зависел от того, что закрыл предыдущий шаг.
          await reset(page, '/archive');
          await page.getByText('Собрали релиз').first().click();
          const reader = page.getByRole('dialog').last();
          await reader.getByRole('button', { name: 'Действия с заметкой' }).click();
          await page.getByRole('dialog', { name: 'Действия с заметкой' }).waitFor({ timeout: 8_000 });
        });

        await step(page, theme, 'save-as', async () => {
          const sheet = page.getByRole('dialog', { name: 'Действия с заметкой' });
          await sheet.getByRole('button', { name: /Сохранить как/ }).click();
          await page.waitForTimeout(900);
        });
        await closeTopSheet(page);
        await page.keyboard.press('Escape').catch(() => {});

        await step(page, theme, 'ai', async () => {
          await page.goto('/ai');
          await page.waitForTimeout(1_800);
        });

        await step(page, theme, 'me', async () => {
          await page.goto('/me');
          await page.waitForTimeout(1_600);
        });

        await step(page, theme, 'settings', async () => {
          await reset(page, '/settings');
          // Карточка аккаунта показывает логин стендового аккаунта — в кадре
          // руководства он не нужен, начинаем с «Синхронизации».
          await page.evaluate(() => window.scrollTo(0, 460));
          await page.waitForTimeout(1_200);
        });
        await closeTopSheet(page);

        await page.goto('/login').catch(() => {});
        await page.evaluate(() => localStorage.clear()).catch(() => {});

        expect(account.uid, 'вход не состоялся — снимать нечего').toBeTruthy();
      });
    });
  }
}
