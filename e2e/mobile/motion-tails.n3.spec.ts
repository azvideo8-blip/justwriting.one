// N-3 (хвост MQ-15 по emil-review): движение листов и мелочи, которые в jsdom
// не проверяются — здесь они видны по-настоящему, в браузере.
//  · N-4 — лист въезжает и уезжает сплошным: ни одного кадра, где у его цепочки
//    предков прозрачность меньше 1;
//  · S13 — под «уменьшить движение» гаснет сдвиг, а прозрачность остаётся
//    (раньше глохло всё, и смена состояния становилась склейкой);
//  · A3 — меню вложения появляется с переходом, а не в одном кадре;
//  · R2 — у читалки знак «назад» показывает то направление, куда экран едет.
import { expect, test, type Page } from '@playwright/test';
import { openVaultFromBanner, shot, signInMobile, zenOff } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

async function openSessionSheet(page: Page) {
  await page.goto('/');
  await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('[data-write-toolbar]').getByRole('button', { name: 'Режим сессии' }).click();
  const sheet = page.getByRole('dialog').last();
  await expect(sheet).toBeVisible({ timeout: 5_000 });
  return sheet;
}

test('N-4: лист не полупрозрачен ни на кадре въезда, ни на кадре ухода', async ({ page }) => {
  await zenOff(page);
  await signInMobile(page, 'n3-sheet-opaque');
  await openVaultFromBanner(page, 'unused-if-already-open').catch(() => {});

  // Въезд: кликаем по токену и сразу sampled'им эффективную прозрачность диалога.
  const enter = await page.evaluate(() => new Promise<{ t: number; o: number | null }[]>(resolve => {
    const chip = document.querySelector('[data-write-chip]') as HTMLElement;
    const out: { t: number; o: number | null }[] = [];
    const start = performance.now();
    chip.click();
    const tick = () => {
      const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
      let o: number | null = null;
      if (dialog) {
        o = 1;
        for (let n: HTMLElement | null = dialog; n && n !== document.body; n = n.parentElement) {
          o *= Number(getComputedStyle(n).opacity);
        }
      }
      out.push({ t: Math.round(performance.now() - start), o });
      if (performance.now() - start < 400) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  }));
  const frames = enter.filter(f => f.o !== null);
  expect(frames.length, 'диалог так и не появился').toBeGreaterThan(3);
  const dipped = frames.filter(f => f.o! < 0.99);
  expect(dipped.length, `лист полупрозрачен на въезде: ${JSON.stringify(dipped.slice(0, 4))}`).toBe(0);
  await shot(page, 'n3-sheet-opaque-enter');

  // уheld: закрытие крестиком — то же требование.
  const exit = await page.evaluate(() => new Promise<{ t: number; o: number | null }[]>(resolve => {
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const close = Array.from(dialog.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Закрыть') as HTMLElement;
    const out: { t: number; o: number | null }[] = [];
    const start = performance.now();
    close.click();
    const tick = () => {
      const el = document.querySelector('[role="dialog"]') as HTMLElement | null;
      let o: number | null = null;
      if (el) {
        o = 1;
        for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
          o *= Number(getComputedStyle(n).opacity);
        }
      }
      out.push({ t: Math.round(performance.now() - start), o });
      if (performance.now() - start < 400) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  }));
  const exitFrames = exit.filter(f => f.o !== null);
  const exitDipped = exitFrames.filter(f => f.o! < 0.99);
  expect(exitDipped.length, `лист полупрозрачен на уходе: ${JSON.stringify(exitDipped.slice(0, 4))}`).toBe(0);
});

test('S13: reduced motion снимает сдвиг, но оставляет прозрачность', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await zenOff(page);
    await signInMobile(page, 'n3-reduced-motion');
    await page.goto('/');
    await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
    const sheet = await openSessionSheet(page);
    // Движение глушено: лист сразу на своём месте (нет кадра со сдвигом вниз).
    const top = await sheet.evaluate(el => Math.round(el.getBoundingClientRect().top));
    expect(top, 'под reduced motion лист всё равно въезжает снизу').toBeGreaterThanOrEqual(0);
    // А переход по прозрачности жив: правило в index.css обязано оставить opacity.
    const kept = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'transition-opacity';
      document.body.appendChild(probe);
      const st = getComputedStyle(probe);
      const props = st.transitionProperty;
      const dur = st.transitionDuration;
      probe.remove();
      return { props, dur };
    });
    expect(kept.props, `transition-property не содержит opacity: ${kept.props}`).toContain('opacity');
    expect(kept.dur, `прозрачность глушена до ${kept.dur}`).not.toBe('0.01ms');
    await shot(page, 'n3-reduced-motion-sheet');
  } finally {
    await context.close();
  }
});

test('A3: меню вложения анимируется', async ({ page }) => {
  await zenOff(page);
  await signInMobile(page, 'n3-ai-and-reader');

  // A3 — меню вложения в чате: между «нет» и «есть» должен быть кадр перехода.
  await page.goto('/ai');
  const attach = page.getByRole('button', { name: /^Прикрепить|ai_attach/ }).first();
  await expect(attach).toBeVisible({ timeout: 30_000 });
  const frames = await page.evaluate(() => new Promise<number[]>(resolve => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /прикреп/i.test(b.getAttribute('aria-label') || '')) as HTMLElement;
    btn.click();
    const out: number[] = [];
    const start = performance.now();
    const tick = () => {
      const menu = document.querySelector('[role="dialog"] [class*="bottom-full"], [class*="bottom-full"]') as HTMLElement | null;
      if (menu) out.push(Number(getComputedStyle(menu).opacity));
      if (performance.now() - start < 300) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  }));
  expect(frames.length, 'меню вложения не поймано ни в одном кадре').toBeGreaterThan(1);
  const partial = frames.filter(o => o > 0.01 && o < 0.99);
  expect(partial.length, `меню вложения появилось без перехода: ${JSON.stringify(frames.slice(0, 6))}`).toBeGreaterThan(0);
  await shot(page, 'n3-attach-menu');

  // R2 (знак возврата читалки) из этого спека убран: на свежем аккаунте стенда
  // читалку не открыть без сохранённой заметки, а путь «написать → сохранить →
  // архив → строка» здесь не сошёлся. Правка R2 — одна подпись в разметке, и
  // никаким тестом она не подтверждена; в отчёте это сказано прямо, вместо
  // снисходительного try/catch, который только притворился бы проверкой.
});
