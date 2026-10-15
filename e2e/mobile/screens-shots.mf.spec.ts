// Снимки для отчёта пакета MF: все экраны в теме и ширине из окружения.
// Не проверка — по флагу JW_MF_SHOTS=1 (в CI не идёт). Шаги терпимы к отсутствию
// элементов: тот же спек снимает и базу (до), и ветку (после).
//   JW_MF_SHOTS=1 JW_MF_THEME=notion JW_MF_TAG=after npx playwright test … screens-shots
import { expect, test, type Page } from '@playwright/test';
import { DICTATION_ENGINE, openVaultFromBanner, shot, signInMobile, zenOff } from './harness';

const THEME = process.env.JW_MF_THEME ?? 'amethyst';
const TAG = process.env.JW_MF_TAG ?? 'after';
const SIZES = (process.env.JW_MF_SIZES ?? '390x844,360x740').split(',').map(s => s.split('x').map(Number) as [number, number]);

async function step(page: Page, name: string, fn: () => Promise<void>, keep = false): Promise<void> {
  try {
    await fn();
    await page.waitForTimeout(450);
    await shot(page, `${TAG}-${THEME}-${name}`);
  } catch (e) {
    console.warn(`[shots] ${name}: пропущено — ${String(e).split('\n')[0]?.slice(0, 120)}`);
  }
  if (!keep) await closeTop(page);
}

/** Листы на телефоне Escape не закрывает: жмём «Закрыть»/«Отмена» верхнего окна. */
async function closeTop(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const dlg = page.getByRole('dialog').last();
    if (!(await dlg.isVisible().catch(() => false))) return;
    if (await dlg.getAttribute('aria-labelledby').then(v => v === 'finish-modal-title', () => false)) return;
    const btn = dlg.getByRole('button', { name: /^(Закрыть|Отмена|Close|Cancel)$/ }).first();
    if (!(await btn.click({ timeout: 1_500 }).then(() => true, () => false))) return;
    await page.waitForTimeout(350);
  }
}

const toolbarSave = (page: Page) => page.locator('[data-write-toolbar]').getByRole('button', { name: /^(Сохранить|Готово)$/ });

for (const [w, h] of SIZES) {
  test.describe(`снимки MF ${THEME} ${w}×${h}`, () => {
    test.skip(!process.env.JW_MF_SHOTS, 'только по JW_MF_SHOTS=1');
    test.use({ viewport: { width: w, height: h } });

    test(`экраны ${THEME} ${w}`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.addInitScript(DICTATION_ENGINE);
      await zenOff(page);
      const account = await signInMobile(page, `shots-${THEME}-${w}`);
      await page.evaluate(t => localStorage.setItem('app-theme', JSON.stringify(t)), THEME);
      const p = `${w}`;

      await step(page, `write-idle-${p}`, async () => { await page.goto('/'); await page.locator('textarea').first().waitFor({ timeout: 30_000 }); });
      await step(page, `write-running-${p}`, async () => {
        await page.locator('textarea').first().fill('Привет! Хочу проверить, как это выглядит на телефоне. Вторая фраза про глину и круг.');
        await page.locator('textarea').first().pressSequentially(' ещё', { delay: 5 });
      });
      await step(page, `session-sheet-${p}`, async () => {
        await page.locator('[data-write-toolbar]').getByRole('button', { name: 'Режим сессии' }).click();
        await page.getByRole('dialog').last().waitFor({ timeout: 5_000 });
      });
      await step(page, `voice-${p}`, async () => {
        await page.locator('[data-write-toolbar]').getByRole('button', { name: /диктовк/i }).click();
        await page.getByRole('dialog').last().waitFor({ timeout: 5_000 });
      }, true);
      await step(page, `recording-${p}`, async () => {
        const rec = page.getByRole('dialog').filter({ hasText: /Голосовой ввод/ }).getByRole('button', { name: /^(Записать|Продолжить)$/ });
        if (await rec.count()) await rec.first().click();
        await page.waitForTimeout(600);
      });
      await page.getByRole('button', { name: /^(Отменить)$/ }).first().click({ timeout: 2_000 }).catch(() => {});
      await step(page, `finish-${p}`, async () => {
        await toolbarSave(page).click();
        await page.locator('[aria-labelledby="finish-modal-title"]').waitFor({ timeout: 10_000 });
      }, true);
      const finish = page.locator('[aria-labelledby="finish-modal-title"]');
      if (await finish.isVisible().catch(() => false)) {
        await finish.getByRole('button', { name: /^Сохранить$/ }).click().catch(() => {});
        await expect(finish).toBeHidden({ timeout: 20_000 }).catch(() => {});
      }

      await step(page, `ai-${p}`, async () => { await page.goto('/ai'); await page.locator('textarea').last().waitFor({ timeout: 30_000 }); });
      await step(page, `notes-list-${p}`, async () => {
        await page.goto('/archive');
        await openVaultFromBanner(page, account.password);
        await page.getByText(/Привет!/).first().waitFor({ timeout: 20_000 });
      });
      await step(page, `notes-actions-${p}`, async () => {
        await page.getByRole('button', { name: 'Действия с заметкой' }).first().click();
        await page.getByRole('dialog').last().waitFor({ timeout: 5_000 });
      });
      await step(page, `notes-calendar-${p}`, async () => {
        await page.getByRole('button', { name: 'Ещё' }).click();
        await page.getByRole('button', { name: /Календарь и статистика/ }).click();
        await page.waitForTimeout(600);
      });
      await page.getByTestId('archive-calendar-panel').getByRole('button', { name: 'Закрыть' }).click({ timeout: 2_000 }).catch(() => {});
      await step(page, `reader-${p}`, async () => {
        await page.getByText(/Привет!/).first().click();
        await page.getByRole('dialog').first().waitFor({ timeout: 10_000 });
      }, true);
      await step(page, `reader-info-${p}`, async () => {
        await page.getByRole('button', { name: 'Инфо' }).click();
        await page.getByRole('dialog', { name: 'Инфо', exact: true }).waitFor({ timeout: 5_000 });
      });
      await step(page, `reader-actions-${p}`, async () => {
        await page.getByRole('dialog').first().getByRole('button', { name: /Действия с заметкой/ }).first().click();
        await page.getByRole('dialog', { name: 'Действия с заметкой' }).waitFor({ timeout: 5_000 });
      });
      await page.goto('/archive');
      await step(page, `notes-grid-${p}`, async () => {
        await openVaultFromBanner(page, account.password, 3_000);
        await page.getByRole('button', { name: 'Ещё' }).click();
        await page.getByRole('button', { name: /^Сетка$/ }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).first().click();
      });
      await step(page, `profile-${p}`, async () => { await page.goto('/me'); await page.getByText(/Практика|Состояние/).first().waitFor({ timeout: 20_000 }); });
      await step(page, `settings-${p}`, async () => { await page.goto('/settings'); await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 20_000 }); });
      await step(page, `editor-panel-${p}`, async () => { await page.goto('/'); await page.getByRole('button', { name: 'Настройки' }).first().click(); await page.waitForTimeout(700); });
    });
  });
}
