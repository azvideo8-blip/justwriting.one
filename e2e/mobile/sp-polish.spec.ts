// SP: живые проверки пакета полировки. (1) шаг 1 первого запуска (SA-2): обе галочки и
// «Продолжить» в видимой области на 360×640, подсказка под серой кнопкой; смена шага
// (SA-23, O1) без прыжка рамки; (2) замер строки списка заметок (SA-18) — только отчёт.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { autoHandlers, createMobileAccount, fullyInViewport, openVaultFromBanner, shot, signInMobile, SHOTS, zenOff } from './harness';

const OUT = resolve(SHOTS, '..');
const dump = (name: string, data: unknown) => { mkdirSync(OUT, { recursive: true }); writeFileSync(resolve(OUT, name), JSON.stringify(data, null, 2)); };

async function signInLeavingFirstRun(page: Page, tag: string): Promise<void> {
  const account = await createMobileAccount(tag);
  await autoHandlers(page, account.password);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.locator('input[type="password"]').press('Enter');
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 90_000 });
}

for (const { w, h } of [{ w: 360, h: 640 }, { w: 390, h: 844 }]) {
  test.describe(`SP: первый запуск ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('SA-2: галочки и «Продолжить» без прокрутки; SA-23: смена шага без прыжка рамки', async ({ page }) => {
      await zenOff(page);
      await signInLeavingFirstRun(page, `sp-step-${w}`);
      const stepper = page.getByTestId('first-run-stepper');
      await expect(stepper).toBeVisible({ timeout: 60_000 });

      const required = stepper.getByRole("checkbox", { name: /^Обязательно/ }).first();
      const next = stepper.getByRole('button', { name: /^Продолжить$/ });
      expect(await fullyInViewport(required), 'обязательная галочка вне экрана').toBe(true);
      expect(await fullyInViewport(next), '«Продолжить» вне экрана').toBe(true);
      await expect(next).toBeDisabled();
      await expect(page.getByTestId('first-run-consent-hint')).toBeVisible();
      const body = await stepper.getByTestId('first-run-policy-footer').evaluate(f => {
        const b = f.previousElementSibling as HTMLElement;
        return { footerH: (f as HTMLElement).offsetHeight, bodyH: b.clientHeight, bodyScroll: b.scrollHeight };
      });
      // Урок живого снимка: подвал не должен съедать экран — на тексте остаётся хотя бы 200 px.
      expect(body.bodyH, `тело шага ${body.bodyH} px при подвале ${body.footerH} px`).toBeGreaterThanOrEqual(200);
      console.warn(`[sp ${w}] подвал ${body.footerH} px, тело ${body.bodyH} из ${body.bodyScroll} px`);
      await shot(page, `sp-step1-${w}`);

      await required.check();
      await expect(page.getByTestId('first-run-consent-hint')).toHaveCount(0);
      // Выборка кадров: рамка степпера не должна прыгать, шаг должен доехать до opacity 1.
      await page.evaluate(() => {
        const w = window as unknown as { __samples: { t: number; top: number; left: number; w: number; h: number; step: string | null; op: number }[] };
        w.__samples = [];
        const t0 = performance.now();
        const tick = () => {
          const s = document.querySelector('[data-testid="first-run-stepper"]') as HTMLElement | null;
          const st = document.querySelector('[data-stepper-step]') as HTMLElement | null;
          if (s) {
            const r = s.getBoundingClientRect();
            w.__samples.push({ t: performance.now() - t0, top: r.top, left: r.left, w: r.width, h: r.height, step: st?.dataset['stepperStep'] ?? null, op: st ? Number(getComputedStyle(st).opacity) : -1 });
          }
          // Пишем, пока новый шаг не проявился полностью (+300 мс хвоста), но не дольше 6 с:
          // до смены шага клик ждёт сохранения согласия на сервере, и под нагрузкой это долго.
          const done = w.__samples.find(x => x.step !== null && x.step !== 'policy' && x.op >= 0.99);
          if (performance.now() - t0 < 6000 && (!done || performance.now() - t0 < done.t + 300)) requestAnimationFrame(tick);
          else (window as unknown as { __samplesDone?: boolean }).__samplesDone = true;
        };
        requestAnimationFrame(tick);
      });
      await next.click();
      await page.waitForFunction(() => (window as unknown as { __samplesDone?: boolean }).__samplesDone === true, null, { timeout: 10_000 });
      const samples = await page.evaluate(() => (window as unknown as { __samples: { t: number; top: number; left: number; w: number; h: number; step: string | null; op: number }[] }).__samples);
      const firstNew = samples.find(s => s.step !== null && s.step !== 'policy' && s.op >= 0.99);
      const rects = new Set(samples.map(s => `${s.top}|${s.left}|${s.w}|${s.h}`));
      const swap = samples.filter(s => s.step !== 'policy' && s.step !== null)[0];
      // SA-23 охраняет саму смену (уход 150 мс + вход 220 мс), а не путь до неё: клик
      // сначала ждёт сохранения согласия на сервере (FirstRunStepper, savePrivacyConsent),
      // и время раннера под нагрузкой (915 мс в CI 43845851904) — сеть, а не анимация.
      // Отсчёт — с первого кадра, где старый шаг начал уходить; при reduced motion
      // ухода нет — с первого кадра нового шага.
      const exitStart = samples.find(s => s.step === 'policy' && s.op < 0.99) ?? swap;
      const transitionMs = firstNew && exitStart ? firstNew.t - exitStart.t : null;
      console.warn(`[sp ${w}] кадров ${samples.length}, рамок разных ${rects.size}, новый шаг «${swap?.step}» виден на ${Math.round(firstNew?.t ?? -1)} мс, смена ${Math.round(transitionMs ?? -1)} мс`);
      dump(`sp-step-transition-${w}.json`, { samples, distinctFrameRects: rects.size, newStepFullyVisibleAtMs: firstNew?.t ?? null, transitionMs });
      expect(rects.size, 'рамка степпера прыгала при смене шага').toBe(1);
      expect(firstNew, 'новый шаг не доехал до opacity 1').toBeTruthy();
      // Норма ~300 мс; при всех ядрах под нагрузкой браузер теряет кадры — до 630 мс
      // (17.11, 40 прогонов). Вход, растянутый до 1,5 с, даёт > 800 и ловится.
      expect(transitionMs!, 'смена шага дольше 800 мс').toBeLessThan(800);
      await shot(page, `sp-step2-${w}`);
    });
  });
}

async function saveNote(page: Page, text: string, title: string, tag: string): Promise<void> {
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill(text);
  await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
  const finish = page.locator('[aria-labelledby="finish-modal-title"]');
  await expect(finish).toBeVisible({ timeout: 15_000 });
  const titleInput = finish.getByLabel(/Название/).first();
  if (await titleInput.isVisible().catch(() => false)) await titleInput.fill(title);
  const tagInput = finish.getByLabel(/тег/i).first();
  if (await tagInput.isVisible().catch(() => false)) { await tagInput.fill(tag); await tagInput.press('Enter'); }
  await finish.getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(finish).toBeHidden({ timeout: 20_000 });
}

for (const { w, h } of [{ w: 360, h: 640 }, { w: 390, h: 844 }]) {
  test.describe(`SP: SA-18 замер строки списка ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('ширина заголовка, число строк в экране (только отчёт)', async ({ page }) => {
      test.setTimeout(240_000);
      await zenOff(page);
      const account = await signInMobile(page, `sp-sa18-${w}`);
      const titles = [
        'Сегодня глина была послушной, а потом',
        'Разговор с мамой про осень и про дом',
        'Утро в мастерской, обжиг и глазурь',
        'Записка себе на следующую неделю',
        'Длинный день, короткая запись вечером',
        'Про дорогу домой через старый парк',
      ];
      for (const [i, t] of titles.entries()) await saveNote(page, `${t}. Ещё несколько слов текста для превью, номер ${i}.`, t, 'глина');
      await page.goto('/archive');
      await openVaultFromBanner(page, account.password);
      await page.getByText(titles[0]!).first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(600);
      const m = await page.evaluate((all) => {
        const vh = window.innerHeight;
        return all.map(t => {
          const el = Array.from(document.querySelectorAll('*')).find(e => e.children.length === 0 && e.textContent?.trim() === t) as HTMLElement | undefined;
          if (!el) return { title: t, found: false };
          const r = el.getBoundingClientRect();
          const row = el.closest('[data-testid="note-row"], li, [role="listitem"]') as HTMLElement | null;
          const rr = (row ?? el).getBoundingClientRect();
          return { title: t, found: true, width: Math.round(r.width), truncated: el.scrollWidth > el.clientWidth + 1, rowHeight: Math.round(rr.height), fullyVisible: rr.top >= 0 && rr.bottom <= vh };
        });
      }, titles);
      const visible = m.filter(x => x.found && x.fullyVisible).length;
      console.warn(`[sa18 ${w}] строк целиком в экране: ${visible}; ${JSON.stringify(m)}`);
      dump(`sa18-measure-${w}.json`, { viewport: { w, h }, visibleRows: visible, rows: m });
      await shot(page, `sp-sa18-notes-${w}`);
    });
  });
}

// SA-24: подписи настроения 12 px не должны вылезать за экран (живой снимок 360: «дость», «Интер»).
for (const { w, h } of [{ w: 360, h: 640 }, { w: 390, h: 844 }]) {
  test.describe(`SP: «Записано.» ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('все шесть настроений целиком в экране', async ({ page }) => {
      await zenOff(page);
      await signInMobile(page, `sp-mood-${w}`);
      await page.goto('/');
      const editor = page.locator('textarea').first();
      await editor.waitFor({ state: 'visible', timeout: 30_000 });
      await editor.fill('Короткая запись, чтобы открыть окно сохранения.');
      await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
      const finish = page.locator('[aria-labelledby="finish-modal-title"]');
      await expect(finish).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(600);
      const moods = finish.locator('button[aria-pressed]').filter({ has: page.locator('span:text-matches("^(😊|😢|😠|😨|😖|🤔)$")') });
      expect(await moods.count()).toBe(6);
      for (let i = 0; i < 6; i++) expect(await fullyInViewport(moods.nth(i)), `настроение ${i} вылезло за экран`).toBe(true);
      await shot(page, `sp-finish-moods-${w}`);
    });
  });
}
