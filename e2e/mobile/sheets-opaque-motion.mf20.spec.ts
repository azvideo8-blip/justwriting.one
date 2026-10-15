// MF-20 (SA-7 + SA-6): листы на телефоне были прозрачны на 60 % (`--surface-card`
// аметиста — rgba(…, 0.4)) и исчезали за один кадр. Теперь фон листа
// непрозрачный во всех четырёх темах, а уход — вниз за ~200 мс.
import { expect, test, type Page } from '@playwright/test';
import { openVaultFromBanner, shot, signInMobile, zenOff } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

const THEMES = ['amethyst', 'modern', 'notion', 'spotify'] as const;

async function openSetupSheet(page: Page) {
  await page.goto('/');
  await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('[data-write-toolbar]').getByRole('button', { name: 'Режим сессии' }).click();
  const sheet = page.getByRole('dialog').last();
  await expect(sheet).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(500);
  return sheet;
}

test('MF-20: фон листа непрозрачен в четырёх темах; закрытие — уход вниз, а не склейка', async ({ page }) => {
  await zenOff(page);
  await signInMobile(page, 'mf20-sheets');

  for (const theme of THEMES) {
    await page.evaluate((t) => localStorage.setItem('app-theme', JSON.stringify(t)), theme);
    const sheet = await openSetupSheet(page);
    const bg = await sheet.evaluate(el => getComputedStyle(el).backgroundColor);
    const alpha = /rgba?\(([^)]+)\)/.exec(bg)?.[1]?.split(',').map(s => s.trim())[3];
    await shot(page, `mf20-sheet-${theme}`);
    expect.soft(alpha === undefined || Number(alpha) === 1, `${theme}: фон листа ${bg}`).toBe(true);
    await page.keyboard.press('Escape').catch(() => {});
  }

  // Уход: после «Закрыть» лист ещё в DOM и едет вниз.
  const sheet = await openSetupSheet(page);
  await expect(sheet.getByRole('button', { name: 'Закрыть' }).first()).toBeVisible();
  // Клик — внутри выборки: часы идут от самого нажатия, а не от ответа Playwright.
  const samples = await page.evaluate(() => new Promise<{ t: number; y: number | null }[]>(resolve => {
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).pop() as HTMLElement;
    const close = Array.from(dialog.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Закрыть') as HTMLElement;
    const out: { t: number; y: number | null }[] = [];
    const start = performance.now();
    close.click();
    const tick = () => {
      const el = dialog.isConnected ? dialog : null;
      out.push({ t: Math.round(performance.now() - start), y: el ? Math.round(el.getBoundingClientRect().top) : null });
      if (performance.now() - start < 400) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  }));
  const alive = samples.filter(s => s.y !== null);
  console.warn('[mf20] выборка ухода:', JSON.stringify(samples.filter((_, i) => i % 3 === 0)));
  const lastAlive = alive[alive.length - 1];
  expect(lastAlive?.t ?? 0, 'лист исчез за один кадр').toBeGreaterThanOrEqual(150);
  const ys = alive.map(s => s.y!);
  expect(ys[ys.length - 1]! > ys[0]!, 'лист не уезжает вниз').toBe(true);
});

// MQ-5: «Записано.», лист действий и лист переименования тоже уходят вниз (fix MF-20 лежал в
// мёртвом пути: тело возвращало null раньше, чем ModalShell успевал сыграть exit).
// Часы идут от самого нажатия внутри страницы; «жив» — диалог ещё в DOM и в кадре.
const EXIT_SAMPLER = `(async ({ dialogSel, closeSel, nextDialogSel }) => {
  const dialog = document.querySelector(dialogSel);
  const close = dialog.querySelector(closeSel);
  const out = [];
  const start = performance.now();
  close.click();
  return await new Promise(resolve => {
    const tick = () => {
      const alive = dialog.isConnected;
      const next = nextDialogSel ? document.querySelector(nextDialogSel) : null;
      const bd = next?.parentElement ? Number(getComputedStyle(next.parentElement).opacity) : null;
      out.push({ t: Math.round(performance.now() - start), top: alive ? Math.round(dialog.getBoundingClientRect().top) : null, nextBackdrop: bd });
      if (performance.now() - start < 400) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  });
})`;

async function expectExitsDownward(page: Page, args: { dialogSel: string; closeSel: string }, what: string) {
  const samples = await page.evaluate(`${EXIT_SAMPLER}(${JSON.stringify(args)})`) as { t: number; top: number | null }[];
  const alive = samples.filter(s => s.top !== null);
  const last = alive[alive.length - 1];
  expect(last?.t ?? 0, `${what}: лист исчез за один кадр`).toBeGreaterThanOrEqual(100);
  expect(alive[alive.length - 1]!.top! > alive[0]!.top!, `${what}: лист не уезжает вниз`).toBe(true);
}

test('MQ-5: «Записано.», лист действий и переименование уходят вниз; затемнение при смене листа не гаснет', async ({ page }) => {
  await zenOff(page);
  const account = await signInMobile(page, 'mq5-exits');
  await page.goto('/');
  const area = page.locator('textarea').first();
  await area.waitFor({ state: 'visible', timeout: 30_000 });
  await area.fill('Вечером тревожно. Не могу объяснить почему, просто пишу.');
  await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
  const finish = page.locator('[aria-labelledby="finish-modal-title"]');
  await expect(finish).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await expectExitsDownward(page, { dialogSel: '[aria-labelledby="finish-modal-title"]', closeSel: 'button[aria-label="Закрыть"]' }, '«Записано.»');

  // Сохраняем заметку, чтобы в списке было что открывать.
  await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(finish).toBeVisible({ timeout: 15_000 });
  await finish.getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(finish).toBeHidden({ timeout: 20_000 });

  await page.goto('/archive');
  await openVaultFromBanner(page, account.password);
  const more = page.getByRole('button', { name: 'Действия с заметкой' }).first();
  await more.click({ timeout: 20_000 });
  const actions = page.locator('[role="dialog"][aria-labelledby="note-actions-sheet-title"]');
  await expect(actions).toBeVisible();
  await page.waitForTimeout(500);
  await expectExitsDownward(page, { dialogSel: '[aria-labelledby="note-actions-sheet-title"]', closeSel: 'button[aria-label="Закрыть"]' }, 'лист действий');

  // Действия → переименование: затемнение нового листа стартует не с нуля.
  await more.click();
  await expect(actions).toBeVisible();
  await page.waitForTimeout(500);
  const handoff = await page.evaluate(`(async () => {
    const pencil = document.querySelector('[aria-labelledby="note-actions-sheet-title"] button[aria-label="Изменить название"]');
    const out = [];
    const start = performance.now();
    pencil.click();
    return await new Promise(resolve => {
      const tick = () => {
        const next = document.querySelector('[aria-labelledby="note-rename-title"]');
        if (next?.parentElement) out.push(Number(getComputedStyle(next.parentElement).opacity));
        if (performance.now() - start < 200) requestAnimationFrame(tick); else resolve(out);
      };
      requestAnimationFrame(tick);
    });
  })()`) as number[];
  expect(handoff.length, 'лист переименования не открылся').toBeGreaterThan(0);
  expect(handoff[0]!, `затемнение переименования стартует с ${handoff[0]}`).toBeGreaterThanOrEqual(0.9);

  await page.waitForTimeout(500);
  await expectExitsDownward(page, { dialogSel: '[aria-labelledby="note-rename-title"]', closeSel: 'button:not([disabled])' }, 'лист переименования');
});

// MQ-6: при «Уменьшить движение» лист не едет — промежуточных положений между «за экраном» и «на месте» нет.
test.describe('MQ-6: reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('лист режима открывается без сдвига', async ({ page }) => {
    await zenOff(page);
    await signInMobile(page, 'mq6-reduced');
    await page.goto('/');
    await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
    // Клик внутри страницы; затем все кадры ~400 мс. При reduced motion лист не едет: он либо ещё за
    // экраном (кадр до применения целевого значения), либо уже на месте — промежуточных положений нет.
    const tops = await page.evaluate(() => new Promise<number[]>(resolve => {
      const mode = document.querySelector('[data-write-toolbar] button[aria-label="Режим сессии"]') as HTMLElement;
      mode.click();
      const t0 = performance.now();
      const out: number[] = [];
      const tick = () => {
        const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).pop() as HTMLElement | undefined;
        if (dialog) out.push(Math.round(dialog.getBoundingClientRect().top));
        if (performance.now() - t0 < 400) requestAnimationFrame(tick); else resolve(out);
      };
      requestAnimationFrame(tick);
    }));
    const final = tops[tops.length - 1]!;
    const start = Math.max(...tops);
    const between = tops.filter(t => t > final + 2 && t < start - 2);
    expect(tops.length, 'лист не появился').toBeGreaterThan(0);
    expect(between, `лист ехал, кадры top: ${JSON.stringify(tops)}`).toEqual([]);
  });
});

