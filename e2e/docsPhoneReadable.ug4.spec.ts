// UG-4 (SA-21): /docs на телефоне — измеряем в браузере, а не глазами.
// Три страницы, 390×844, и четыре числа, которые нельзя подделать вёрсткой «на
// глаз»: где заканчивается первый абзац, какая высота у ссылочных рядов,
// читается ли десктопный кадр и развёрнуто ли оглавление.
//
// Прогон: E2E_PORT=3000 npx playwright test e2e/docsPhoneReadable.ug4.spec.ts
// (стенд уже поднят; без него :3000 занят прод-API — тогда задайте свой порт).
import { test, expect } from '@playwright/test';

const PAGES = [
  '/docs/index.html', '/docs/writing.html', '/docs/ai.html', '/docs/notes.html',
  // UG-3: мобильные страницы — те же измерения.
  '/docs/mobile/index.html', '/docs/mobile/writing.html', '/docs/mobile/notes.html',
  '/docs/mobile/ai.html', '/docs/mobile/profile.html',
];

test.use({ viewport: { width: 390, height: 844 } });

test('первый абзац — в первом экране, оглавление свёрнуто', async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    const lead = page.locator('.doc p.lead');
    await expect(lead, `${path}: нет вводного абзаца`).toBeVisible();
    const box = await lead.boundingBox();
    expect(box, `${path}: у вводного абзаца нет геометрии`).not.toBeNull();
    expect(box!.y + box!.height, `${path}: первый абзац ниже экрана 844 px`).toBeLessThanOrEqual(844);

    const summary = page.locator('details.toc > summary');
    await expect(summary, `${path}: оглавления-<details> нет`).toBeVisible();
    expect(await summary.evaluate(el => (el as HTMLDetailsElement).parentElement?.hasAttribute('open')),
      `${path}: оглавление раскрыто и вытесняет текст`).toBe(false);
    const list = page.locator('details.toc > ul');
    expect(await list.count()).toBe(1);
    expect(await list.isVisible(), `${path}: список оглавления виден при закрытом <details>`).toBe(false);
  }
});

test('ссылочные ряды — не меньше 44 px, подписи без капса', async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await page.locator('details.toc').evaluate(el => el.setAttribute('open', ''));

    const small = await page.evaluate(() => {
      const sel = '.toc a, .pager a, .footer-links a, .topbar .app-link, .mnav a, .cards a';
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll(sel)) as HTMLElement[]) {
        const h = el.getBoundingClientRect().height;
        if (h > 0 && h < 44) bad.push(`${el.className || el.tagName}: ${Math.round(h)}px «${el.textContent?.trim().slice(0, 28)}»`);
      }
      return bad;
    });
    expect(small, `${path}: ссылки меньше 44 px — ${small.join('; ')}`).toEqual([]);

    const caps = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
      .filter(el => {
        const s = getComputedStyle(el as Element);
        return s.textTransform === 'uppercase' && (el as HTMLElement).offsetParent !== null && Boolean((el as HTMLElement).textContent?.trim());
      })
      .map(el => `${el.className}: ${el.textContent?.trim().slice(0, 30)}`));
    expect(caps, `${path}: остались капслоновые подписи`).toEqual([]);
  }
});

test('десктопный кадр на телефоне крупный и листается, подпись не уезжает', async ({ page }) => {
  await page.goto('/docs/writing.html');
  const shot = page.locator('figure.shot').first();
  await shot.scrollIntoViewIfNeeded();
  // Кадр с loading="lazy": naturalWidth появляется только после загрузки.
  await shot.locator('img').evaluate((el) => {
    const img = el as HTMLImageElement;
    return img.complete && img.naturalWidth > 0
      ? true
      : new Promise<boolean>((done) => { img.onload = () => done(true); img.onerror = () => done(false); });
  });
  await expect(shot).toBeVisible();
  const metrics = await shot.evaluate((fig) => {
    const img = fig.querySelector('img') as HTMLImageElement;
    return {
      scrollW: (fig as HTMLElement).scrollWidth,
      clientW: (fig as HTMLElement).clientWidth,
      imgW: img.getBoundingClientRect().width,
      imgNatural: img.naturalWidth,
      captionPosition: getComputedStyle(fig.querySelector('figcaption') as Element).position,
    };
  });
  expect(metrics.imgNatural, 'кадр не загружен — проверьте public/docs/img').toBeGreaterThan(400);
  expect(metrics.imgW, 'кадр сжат до ширины экрана — текст на нём не прочитать')
    .toBeGreaterThanOrEqual(Math.min(900, metrics.imgNatural));
  expect(metrics.scrollW > metrics.clientW, 'кадр не листается по горизонтали').toBe(true);
  expect(metrics.captionPosition, 'подпись уезжает вместе с кадром').toBe('sticky');
});
