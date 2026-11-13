// TR-7: знакомство «Как всё устроено» в настоящем браузере. Остальной набор тур
// глушит (harness.suppressTour) — здесь он включён.
//
// Главное, что здесь проверяется, — тур ни разу не оказался на экране вместе с
// окном первого входа и появился не раньше, чем через секунду после последнего.
// Мутации (прогнаны на стенде 13.11, каждая красная):
//  1. tourGate: убрать `dialogQuietMs` и `queued` → «тур появился раньше, чем через
//     секунду после последнего окна» (остальные условия — кэш политики, ответ о
//     синхронизации, код — держат, поэтому наложения нет, но пауза пропадает);
//  2. TourOverlay: фокус в поле текста при показе шага → «шаг 1: фокус не на карточке»;
//  3. TourOverlay.finish: не писать отметку → `mark` после «Готово» не `done`.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createUser, type StandAccount } from '../stand';
import {
  dismissFirstLoginDialogs, fullyInViewport, grantAiConsent, horizontalOverflow, login, shot,
  waitForNavigationSettled, zenOff,
} from './harness';

const CARD = '[data-tour-card]';
const FOREIGN = '[role="dialog"]:not([data-tour-card]), [data-testid="first-run-stepper"]';

interface Probe { overlap: number; lastForeign: number; firstTour: number }

/** Каждые 50 мс: был ли тур на экране вместе с чужим окном и когда кто появился. */
async function installProbe(page: Page): Promise<void> {
  await page.addInitScript((foreignSel: string) => {
    const p = { overlap: 0, lastForeign: 0, firstTour: 0 };
    (window as unknown as { __tourProbe: typeof p }).__tourProbe = p;
    const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    setInterval(() => {
      const tour = document.querySelector('[data-tour-card]');
      const foreign = Array.from(document.querySelectorAll(foreignSel)).some(shown);
      const now = Date.now();
      if (foreign) p.lastForeign = now;
      if (tour && !p.firstTour) p.firstTour = now;
      if (tour && foreign) p.overlap++;
    }, 50);
  }, FOREIGN);
}
const probe = (page: Page) => page.evaluate(() => (window as unknown as { __tourProbe: Probe }).__tourProbe);

/** Вход без глушения тура и без автообработчиков: они нажали бы «Готово» в карточке. */
async function enter(page: Page, account: StandAccount): Promise<void> {
  await zenOff(page);
  await installProbe(page);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.locator('input[type="password"]').press('Enter');
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 90_000 });
  await waitForNavigationSettled(page);
  await dismissFirstLoginDialogs(page, true);
}

async function box(loc: Locator) {
  const b = await loc.boundingBox();
  if (!b) throw new Error('нет рамки у элемента');
  return b;
}
type Rect = { x: number; y: number; width: number; height: number };
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const contains = (outer: Rect, inner: Rect, slack = 3) =>
  inner.x >= outer.x - slack && inner.y >= outer.y - slack
  && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack;

async function expectCardSound(page: Page, label: string): Promise<void> {
  const card = page.locator(CARD);
  await expect(card, `${label}: карточки нет`).toBeVisible({ timeout: 15_000 });
  expect(await fullyInViewport(card), `${label}: карточка не целиком в окне`).toBe(true);
  const o = await horizontalOverflow(page);
  expect(o.scrollWidth, `${label}: горизонтальное переполнение ${JSON.stringify(o.offenders)}`).toBeLessThanOrEqual(o.innerWidth);
  for (const b of await card.getByRole('button').all()) {
    const r = await box(b);
    expect(Math.min(r.width, r.height), `${label}: кнопка «${await b.innerText()}» меньше 44 px`).toBeGreaterThanOrEqual(44);
  }
  await expect(card, `${label}: фокус не на карточке`).toBeFocused();
}

const mark = (page: Page, uid: string) => page.evaluate(id => localStorage.getItem(`jw_tour_v1_${id}`), uid);

for (const [w, h] of [[360, 640], [390, 844]] as const) {
  test.describe(`TR-7: знакомство на телефоне ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('тур после окон первого входа, три шага, отметка, повторный запуск', async ({ page }) => {
      const account = await createUser(`tour-${w}`);
      await enter(page, account);

      // 1–2. Тур появился сам на «Писать» — и ни разу не вместе с окном первого входа.
      const card = page.locator(CARD);
      await expect(card).toBeVisible({ timeout: 45_000 });
      expect(new URL(page.url()).pathname).toBe('/');
      const p = await probe(page);
      expect(p.overlap, 'тур был на экране вместе с окном первого входа').toBe(0);
      expect(p.lastForeign, 'степпер первого входа не показывался — тест ничего не проверил').toBeGreaterThan(0);
      expect(p.firstTour - p.lastForeign, 'тур появился раньше, чем через секунду после последнего окна').toBeGreaterThanOrEqual(1000);
      await expect(card).toContainText('1 из 3');
      await expect(card).toContainText('«Писать» — здесь ты пишешь');
      await expectCardSound(page, 'шаг 1');

      // 3. Клавиатура не поднята: фокус не в поле текста, нижние вкладки на месте.
      expect(await page.evaluate(() => document.activeElement?.tagName), 'клавиатура не поднята').not.toBe('TEXTAREA');
      const nav = page.getByTestId('mobile-bottom-nav');
      await expect(nav).toBeVisible();
      expect(await nav.getAttribute('aria-hidden')).toBeNull();
      const cardBox1 = await box(card);
      const micRing = page.getByTestId('tour-ring-second');
      await expect(micRing).toBeVisible();
      await expect(card).toContainText('микрофон');
      const micBox = await box(page.locator('[data-tour="mic"]'));
      expect(contains(await box(micRing), micBox), 'кольцо не вокруг микрофона').toBe(true);
      expect(intersects(cardBox1, await box(micRing)), 'карточка закрыла микрофон').toBe(false);
      // Главное кольцо — поле текста, а не весь экран с панелями.
      expect(intersects(await box(page.getByTestId('tour-ring')), micBox), 'кольцо поля захватило панель записи').toBe(false);
      // Приложение под туром не нажимается: вкладка «Профиль» под затемнением.
      await nav.getByRole('button', { name: 'Профиль' }).click({ timeout: 2_000, trial: true }).then(
        () => { throw new Error('вкладка под затемнением нажимается'); },
        () => {},
      );
      await shot(page, `tour-1-write-${w}`);

      // 4. Шаг 2 — вкладка «Заметки».
      await card.getByRole('button', { name: 'Дальше' }).click();
      await expect(card).toContainText('2 из 3', { timeout: 15_000 });
      expect(new URL(page.url()).pathname).toBe('/archive');
      await expectCardSound(page, 'шаг 2');
      const ring = page.getByTestId('tour-ring');
      await expect(ring).toBeVisible();
      expect(contains(await box(ring), await box(page.locator('[data-tour="tab-archive"]'))), 'кольцо не вокруг вкладки «Заметки»').toBe(true);
      expect(intersects(await box(card), await box(ring)), 'карточка закрыла вкладку').toBe(false);
      await shot(page, `tour-2-notes-${w}`);

      // Шаг 3 — собеседник. Свежий аккаунт согласия на ИИ не давал: «ИИ выключен».
      await card.getByRole('button', { name: 'Дальше' }).click();
      await expect(card).toContainText('3 из 3', { timeout: 15_000 });
      expect(new URL(page.url()).pathname).toBe('/ai');
      await expectCardSound(page, 'шаг 3');
      await expect(ring).toBeVisible();
      expect(contains(await box(ring), await box(page.locator('[data-tour="persona"]'))), 'кольцо не вокруг собеседника').toBe(true);
      expect(intersects(await box(card), await box(ring)), 'карточка закрыла собеседника').toBe(false);
      await expect(card).toContainText('Сейчас ИИ выключен');
      await expect(card.getByRole('button', { name: 'Пропустить' })).toHaveCount(0);
      await shot(page, `tour-3-ai-${w}`);

      expect(await mark(page, account.uid)).toBeNull();
      await card.getByRole('button', { name: 'Готово' }).click();
      await expect(card).toHaveCount(0);
      expect(await mark(page, account.uid)).toBe('done');
      expect((await probe(page)).overlap).toBe(0);

      // 5. После перезагрузки тура нет.
      await page.goto('/');
      await page.waitForTimeout(6_000);
      await expect(card, 'после перезагрузки тура нет').toHaveCount(0);

      // 6. «Профиль» → «Как всё устроено» → тур с шага 1.
      await nav.getByRole('button', { name: 'Профиль' }).click();
      await page.getByRole('button', { name: 'Как всё устроено' }).click();
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText('1 из 3');
      expect(new URL(page.url()).pathname).toBe('/');
      await page.keyboard.press('Escape');
      await expect(card).toHaveCount(0);
      expect(await mark(page, account.uid)).toBe('skipped:1');
    });

    test('«Пропустить» на шаге 2 → skipped:2, после перезагрузки тура нет', async ({ page }) => {
      const account = await createUser(`tour-skip-${w}`);
      await enter(page, account);
      const card = page.locator(CARD);
      await expect(card).toBeVisible({ timeout: 45_000 });
      await card.getByRole('button', { name: 'Дальше' }).click();
      await expect(card).toContainText('2 из 3', { timeout: 15_000 });
      await card.getByRole('button', { name: 'Пропустить' }).click();
      await expect(card).toHaveCount(0);
      expect(await mark(page, account.uid)).toBe('skipped:2');
      await page.goto('/');
      await page.waitForTimeout(6_000);
      await expect(card).toHaveCount(0);
    });
  });
}

test.describe('TR-7: шаг 3 с согласием на ИИ', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('согласие есть → обычный текст, без «ИИ выключен»', async ({ page }) => {
    await zenOff(page);
    const account = await createUser('tour-consent');
    await login(page, account); // тур заглушен: первый вход проходит харнесс
    grantAiConsent(account.uid);
    await page.goto('/');
    await waitForNavigationSettled(page);
    await page.getByTestId('mobile-bottom-nav').getByRole('button', { name: 'Профиль' }).click();
    await page.getByRole('button', { name: 'Как всё устроено' }).click();
    const card = page.locator(CARD);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Дальше' }).click();
    await expect(card).toContainText('2 из 3', { timeout: 15_000 });
    await card.getByRole('button', { name: 'Дальше' }).click();
    await expect(card).toContainText('3 из 3', { timeout: 15_000 });
    await expect(card).toContainText('Он опирается на разобранные заметки и на те, что приложены к разговору.');
    await expect(card).not.toContainText('ИИ выключен');
  });
});

test.describe('TR-7: знакомство на компьютере 1280×800', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test('тур после окон политики, кода восстановления и синхронизации; три шага; боковая панель', async ({ page }) => {
    const account = await createUser('tour-desktop');
    await enter(page, account);
    const card = page.locator(CARD);
    await expect(card).toBeVisible({ timeout: 45_000 });
    const p = await probe(page);
    expect(p.overlap, 'тур был на экране вместе с окном первого входа').toBe(0);
    expect(p.lastForeign, 'окна первого входа не показывались').toBeGreaterThan(0);
    expect(p.firstTour - p.lastForeign).toBeGreaterThanOrEqual(1000);
    await expectCardSound(page, 'компьютер, шаг 1');
    const ring = page.getByTestId('tour-ring');
    await expect(ring).toBeVisible();
    const micRing = page.getByTestId('tour-ring-second');
    await expect(micRing, 'микрофон на компьютере не подсвечен').toBeVisible();
    await expect(card).toContainText('микрофон');
    expect(intersects(await box(card), await box(micRing)), 'карточка закрыла микрофон').toBe(false);
    await shot(page, 'tour-1-write-desktop');

    await card.getByRole('button', { name: 'Дальше' }).click();
    await expect(card).toContainText('2 из 3', { timeout: 15_000 });
    await expectCardSound(page, 'компьютер, шаг 2');
    expect(contains(await box(ring), await box(page.locator('[data-tour="notes-list"]'))), 'кольцо не вокруг списка').toBe(true);
    // Пустой архив на 800 px занимает всю высоту — карточка стоит внутри кольца,
    // но не на заголовке «Пока нет записей».
    expect(intersects(await box(card), await box(page.getByRole('heading', { name: 'Пока нет записей' })))).toBe(false);
    await shot(page, 'tour-2-notes-desktop');

    await card.getByRole('button', { name: 'Дальше' }).click();
    await expect(card).toContainText('3 из 3', { timeout: 15_000 });
    await expectCardSound(page, 'компьютер, шаг 3');
    expect(contains(await box(ring), await box(page.locator('[data-tour="persona"]'))), 'кольцо не вокруг собеседника').toBe(true);
    expect(intersects(await box(card), await box(ring))).toBe(false);
    await shot(page, 'tour-3-ai-desktop');
    await card.getByRole('button', { name: 'Готово' }).click();
    await expect(card).toHaveCount(0);
    expect(await mark(page, account.uid)).toBe('done');

    // Повторный запуск: боковая панель → «Как всё устроено».
    await page.goto('/');
    await page.waitForTimeout(4_000);
    await expect(card).toHaveCount(0);
    await page.locator('nav, aside').first().hover().catch(() => {});
    await page.getByRole('button', { name: 'Как всё устроено' }).first().click({ force: true });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('1 из 3');
  });
});
