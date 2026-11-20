// Помощники мобильных спеков (e2e/mobile/*.spec.ts).
//
// Перенесено из харнесса аудита Fable 2026-10-12
// (justwriting-docs/audit-evidence/mobile-ux-fable-2026-10-12/specs/_harness.ts):
// вход, снятие онбординговых окон и геометрические проверки. Посев на 36 заметок
// и снимки-улики остались в отчёте аудита — спекам они не нужны.
//
// Данные только синтетические: аккаунты создаются на каждый прогон через
// админ-API GoTrue, пароли генерируются.
import { expect, test, type Page, type Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUser, standEnv, type StandAccount } from '../stand';

export type Account = StandAccount;

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Куда класть снимки: по умолчанию в `test-results/` (вне git). Аудит, которому
 * нужны улики, задаёт JW_MOBILE_SHOTS — свою папку в docs на пакет: снимки
 * предыдущего пакета — это улики «до», и переснимать их поверх нельзя. Раньше
 * путь по умолчанию вёл в папку пакета 13.10, и каждый прогон перед выпуском
 * перезаписывал её снимки (104 файла, блокировали rebase docs).
 */
export const SHOTS = process.env.JW_MOBILE_SHOTS
  ?? resolve(HERE, '..', '..', 'test-results', 'mobile-shots');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Имена целей онбординга — с русскими и английскими вариантами: обход EN и
// тёмной темы (§1.4) снимает те же окна в английской локали, а галочка согласия
// ищется по доступному имени.
const BOX_NAMES = [/Код сохранён|сохранил|recovery code saved|saved the (recovery )?code/i, /прочита(л|н)|I have read/i];
const SYNC_ON = /Включить синхронизацию|^Turn sync on$/i;
const SYNC_OFF = /Оставить выключенной|^Leave it off$/i;
// Узкий набор для обработчика: он живёт весь прогон, и широкие слова вроде
// «Закрыть» заставили бы его закрывать листы действий прямо в тестах MB-4/MB-9.
const GO_NAMES = /^(Продолжить|Понятно|Переместить в аккаунт|Включить синхронизацию|Готово|Continue|Got it|Move to account|Turn sync on|Done)$/i;
// Широкий — только пока снимаются окна первого запуска.
const DIALOG_GO = /^(Продолжить|Понятно|Закрыть|Готово|Начать|Переместить в аккаунт|Continue|Got it|Close|Done|Start|Move to account)$/i;

/** SQL через psql контейнера стенда; сверхпользователь, минуя PostgREST. */
function psql(sql: string): void {
  // Машина без Docker: тот же postgres, но вызванный напрямую. Ключевая
  // переменная стоит только на нативном стенде — в CI пути не меняется.
  const bin = process.env.STAND_PSQL_BIN;
  if (bin) {
    const port = standEnv().STAND_PG_PORT ?? '5440';
    execFileSync(bin, ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
    return;
  }
  execFileSync(
    'docker',
    ['exec', '-i', 'jw-stand-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: sql, stdio: ['pipe', 'inherit', 'inherit'] },
  );
}

/**
 * Право на мобильный макет (MB-1, миграция 0041) даёт роль admin. Колонку role
 * охраняет protect_user_columns, поэтому обход — тот же, что в операторских
 * скриптах стенда: на время запроса снимаются триггеры. uid приходит из GoTrue,
 * но всё равно проверяется: правка в SQL из внешнего значения.
 */
export function grantMobileLayoutAccess(uid: string): void {
  if (!UUID.test(uid)) throw new Error(`grantMobileLayoutAccess: uid не uuid — ${uid.slice(0, 8)}…`);
  psql(`set session_replication_role = replica;
update public.users set role = 'admin' where uid = '${uid}';
set session_replication_role = origin;`);
}

/** Аккаунт, которому открыт мобильный макет. */
export async function createMobileAccount(tag: string): Promise<Account> {
  const account = await createUser(tag);
  grantMobileLayoutAccess(account.uid);
  return account;
}

/**
 * Согласие на ИИ в базе стенда. Кнопка «Предоставить согласие» в UI не работает,
 * пока сейф заперт (аудит Fable, §3), а спеку про подсказку согласия нужен
 * аккаунт с согласием и без — поэтому согласие выдаётся напрямую.
 *
 * MR-12: вызывать только ПОСЛЕ первого входа. Строка в `public.users` создаётся
 * при первом входе, до неё `UPDATE` задевает 0 строк и молча «не работает»: чат
 * отвечает «разрешите использование ИИ в настройках», и спек падает не на правке,
 * а на севе. После выдачи — перезагрузить страницу.
 */
export function grantAiConsent(uid: string, version = 3): void {
  if (!UUID.test(uid)) throw new Error('grantAiConsent: uid не uuid');
  psql(`set session_replication_role = replica;
update public.users set ai_consent_at = now(), ai_consent_version = ${version} where uid = '${uid}';
set session_replication_role = origin;`);
}

/**
 * Клик с запасным dispatchEvent: на 320 px часть целей онбординга перекрывают
 * нижняя панель и чипы (F-18, F-27 — правки следующего batches), и обычный клик
 * висит до таймаута. Для харнесса это не подмена продукта: событие то же,
 * просто точка попадания не проверяется.
 */
async function tap(loc: Locator): Promise<boolean> {
  if (await loc.click({ timeout: 1_500 }).then(() => true, () => false)) return true;
  // Элемента уже нет (окно закрылось от прошлого нажатия) — запасные ветки ниже
  // ждали бы его по actionTimeout, 20 с каждая: 40 с пустого ожидания в каждом
  // тесте, почти вся длительность мобильного набора в CI (замер 0.9.39).
  if (!(await loc.count().catch(() => 0))) return false;
  // Нативный el.click(): скрытый input с реактивным onChange (галочка
  // «Я сохранил код» рисуется соседним span). dispatchEvent('click') тоже
  // возвращает успех, даже если состояние не изменилось, — поэтому он последним.
  if (await loc.evaluate(el => { (el as HTMLElement & { click?: () => void }).click?.(); return true; }, undefined, { timeout: 1_500 }).catch(() => false)) {
    await loc.page().waitForTimeout(150);
    return true;
  }
  return loc.dispatchEvent('click', undefined, { timeout: 1_500 }).then(() => true, () => false);
}

/**
 * Галочка в окне первого запуска: «Продолжить» активна только после неё, а tap()
 * считает успех по факту события, не по состоянию — поэтому здесь сверкаемся с
 * isChecked() после каждой попытки и идём по цепочке input → label → нативный
 * click. Без этого обработчик окна зацикливается на выключенной кнопке и ждёт,
 * пока она скроется (так и падал весь мобильный набор 12.10).
 */
async function tickBox(dialog: Locator, name: RegExp): Promise<boolean> {
  const box = dialog.getByRole('checkbox', { name }).first();
  if (!(await box.count().catch(() => 0))) return false;
  if (await box.isChecked().catch(() => false)) return true;
  const label = dialog.locator('label', { has: box }).first();
  for (const target of [box, label]) {
    if (!(await target.count().catch(() => 0))) continue;
    await tap(target);
    if (await box.isChecked().catch(() => false)) return true;
  }
  await box.evaluate((el: Element) => {
    const input = el as HTMLInputElement;
    input.click();
    input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }).catch(() => {});
  return box.isChecked().catch(() => false);
}

/** Тот же путь в обратную сторону: снять галочку и проверить, что снялась. */
async function untickBox(dialog: Locator, name: RegExp): Promise<boolean> {
  const box = dialog.getByRole('checkbox', { name }).first();
  if (!(await box.count().catch(() => 0))) return false;
  if (!(await box.isChecked().catch(() => true))) return true;
  const label = dialog.locator('label', { has: box }).first();
  for (const target of [box, label]) {
    if (!(await target.count().catch(() => 0))) continue;
    await tap(target);
    if (!(await box.isChecked().catch(() => true))) return true;
  }
  return false;
}

/**
 * TR-7: знакомство «Как всё устроено» само стартует у вошедшего с нулём заметок —
 * то есть у каждого свежего аккаунта этого набора, и карточка закрыла бы экран в
 * десятках спеков. По умолчанию харнесс его глушит: отметка `jw_tour_v1_<uid>`
 * читается как `done` для любого uid (вход бывает и мимо `login()`, где uid под
 * рукой нет). Сам тур проверяет `tour.tr.spec.ts` — он входит с `{ tour: true }`.
 */
export async function suppressTour(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __jwTourSuppressed?: boolean };
    if (w.__jwTourSuppressed) return;
    w.__jwTourSuppressed = true;
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      const value = get.call(this, key);
      return value === null && typeof key === 'string' && key.startsWith('jw_tour_v1_') ? 'done' : value;
    };
  });
}

/** TR-7: окна первого входа — без карточки знакомства: она тоже `role=dialog`. */
const NOT_TOUR = ':not([data-tour-card])';

/**
 * Автообработчики (из харнесса Fable): окно сейфа и онбординговые окна снимаются,
 * когда мешают действию, а не только там, где тест про них вспомнил. Окна первого
 * запуска приезжают с задержкой в несколько секунд — без этого клик висит до
 * таймаута, и падение выглядит как дефект правки.
 *
 * `autoUnlock: false` — для спеков про запертый сейф: иначе обработчик сам
 * введёт пароль и разблокирует его раньше, чем тест успеет увидеть баннер.
 */
export async function autoHandlers(page: Page, password: string, opts: { autoUnlock?: boolean; tour?: boolean } = {}): Promise<void> {
  if (!opts.tour) await suppressTour(page);
  const unlock = page.getByRole('button', { name: 'Разблокировать', exact: true });
  if (opts.autoUnlock !== false) await page.addLocatorHandler(unlock, async () => {
    const dialog = page.getByRole('dialog').filter({ has: unlock });
    const remember = dialog.getByRole('checkbox').first();
    if (await remember.isVisible().catch(() => false) && !(await remember.isChecked().catch(() => true))) await remember.check().catch(() => {});
    await dialog.locator('input[type="password"]').first().fill(password);
    await unlock.click().catch(() => {});
    await unlock.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  }, { times: 5 });

  // Только активная кнопка: обработчик по выключенной «Продолжить» перехватывает
  // каждое действие теста и ждёт, пока она скроется, — чего не происходит, пока
  // не проставлены галочки окна.
  // MF-3: лист сессии — не окно первого запуска: его «Продолжить» снимает паузу.
  const go = page.locator(`[role="dialog"]${NOT_TOUR}`).filter({ hasNot: page.locator('[data-session-rows]') })
    .getByRole('button', { name: GO_NAMES, disabled: false }).first();
  await page.addLocatorHandler(go, async () => {
    const dialog = page.getByRole('dialog').filter({ has: go }).first();
    // В окне кода восстановления «Продолжить» становится активной только после
    // того, как код скопирован и отмечен «я сохранил»: трогаем оба элемента.
    const copy = dialog.getByRole('button', { name: /Скопировать код/ });
    if (await copy.count().catch(() => 0)) await tap(copy.first());
    for (const name of BOX_NAMES) await tickBox(dialog, name).catch(() => false);
    if (await go.isEnabled().catch(() => false)) await tap(go);
    await page.waitForTimeout(300);
  }, { times: 10 });
}

/**
 * MC-6: на телефоне первый вход — не стоп окон, а три полноэкранных шага.
 * Окно онбординга для specs больше не `role=dialog`, поэтому у харнесса
 * появляется отдельная ветка: пройти шаги, пока экран жив. Делает ровно то же,
 * что делал с окнами: ставит обязательные галочки, при `forgetDevice` снимает
 * переключатель «Это моё устройство», при `syncOn === false` выбирает «Только на этом устройстве».
 */
async function walkFirstRunStepper(page: Page, syncOn: boolean, forgetDevice: boolean, seen: string[]): Promise<boolean> {
  const stepper = page.locator('[data-testid="first-run-stepper"]');
  if (!(await stepper.isVisible().catch(() => false))) return false;

  const title = await stepper.getByRole('heading').first().innerText().catch(() => '');
  if (title && !seen.includes(title)) seen.push(title);

  let acted = false;
  for (const name of [/^Обязательно|прочитал|^Required|I have read/i, /Код сохранён|сохранил|Recovery code saved|saved the code/i]) {
    if (await tickBox(stepper, name)) acted = true;
  }
  if (forgetDevice) {
    const device = stepper.getByRole('switch', { name: /мо[ёе] устройство|This is my device/i }).first();
    if (await device.count().catch(() => 0) && (await device.getAttribute('aria-checked')) === 'true') {
      acted = (await tap(device)) || acted;
    }
  }
  // MF-22: шаг «Облако» — две равные кнопки; затем, если в облаке есть заметки,
  // вопрос о загрузке («Без загрузки» — как раньше выключенный переключатель).
  const cloud = stepper.getByRole('button', {
    name: syncOn ? /^(Включить облако|Turn the cloud on|Без загрузки|Not now)$/ : /^(Только на этом устройстве|Only on this device)$/,
  }).first();
  if (await cloud.isVisible().catch(() => false)) acted = (await tap(cloud)) || acted;

  const next = stepper.getByRole('button', { name: /^(Продолжить|Дальше|Начать писать|Continue|Next|Start writing)$/ }).first();
  if (await next.isVisible().catch(() => false) && await next.isEnabled().catch(() => false)) {
    acted = (await tap(next)) || acted;
  }
  return acted;
}

export async function dismissFirstLoginDialogs(page: Page, syncOn = true, budgetMs = 40_000, forgetDevice = false): Promise<string[]> {
  const seen: string[] = [];
  const deadline = Date.now() + budgetMs;
  let quiet = 0;
  while (Date.now() < deadline) {
    let acted = false;
    let open = false;
    // MC-6: сначала степпер — на мобильном макете окон первого входа нет вовсе.
    if (await walkFirstRunStepper(page, syncOn, forgetDevice, seen)) acted = true;
    // Степпер на экране, но жать нечего (шаг ждёт сохранения согласия, кнопка
    // выключена) — это не «тихо»: на машине GitHub ожидание длиннее 1,2 с, и
    // обработчик уходил, оставляя шаг «Облако» висеть (CI 20.11, TR-7 390×844).
    if (await page.locator('[data-testid="first-run-stepper"]').isVisible().catch(() => false)) open = true;
    for (const dialog of await page.locator(`[role="dialog"]${NOT_TOUR}`).all()) {
      if (!(await dialog.isVisible().catch(() => false))) continue;
      open = true;
      const heading = await dialog.getByRole('heading').first().innerText().catch(() => '');
      if (heading && !seen.includes(heading)) seen.push(heading);
      const copy = dialog.getByRole('button', { name: /Скопировать код/ });
      if (await copy.count().catch(() => 0) && !(await copy.first().getAttribute('aria-pressed').catch(() => null))) await tap(copy.first());
      for (const name of BOX_NAMES) {
        // Сам input может быть скрыт (галочка рисуется соседним span) — тогда
        // isVisible() пропускает шаг, «Продолжить» остаётся выключенной, и
        // обработчик зацикливается. tickBox сверяется с состоянием, а не с тем,
        // что событие ушло.
        if (await tickBox(dialog, name)) acted = true;
      }
      // «Это моё устройство» по умолчанию стоит: сейф запоминается на устройстве,
      // и после перезагрузки он разблокирован. Для спеки про запертый сейф его
      // надо снять — это тот же путь, что «не спрашивать здесь пароль шифрования».
      if (forgetDevice && (await untickBox(dialog, /мо[ёе] устройство|Это мой компьютер|my device/i))) acted = true;
      const sync = dialog.getByRole('button', { name: syncOn ? SYNC_ON : SYNC_OFF });
      const go = dialog.getByRole('button', { name: DIALOG_GO });
      if (await sync.isVisible().catch(() => false)) acted = (await tap(sync)) || acted;
      else if (await go.first().isVisible().catch(() => false) && await go.first().isEnabled().catch(() => false)) {
        acted = (await tap(go.first())) || acted;
      }
    }
    if (acted || open) { quiet = 0; await page.waitForTimeout(300); continue; }
    if (++quiet >= 4) return seen;
    await page.waitForTimeout(300);
  }
  const left = await page.evaluate(() => Array.from(document.querySelectorAll('[role=dialog]'))
    .map(d => (d as HTMLElement).innerText.slice(0, 60).replace(/\n+/g, ' ')));
  console.warn('[dialogs] окно осталось открытым:', JSON.stringify(left));
  return seen;
}

export async function unlockVaultIfAsked(page: Page, password: string, wait = 6_000): Promise<boolean> {
  const btn = page.getByRole('button', { name: 'Разблокировать', exact: true });
  if (!(await btn.isVisible({ timeout: wait }).catch(() => false))) return false;
  const dialog = page.getByRole('dialog').filter({ has: btn });
  const remember = dialog.getByRole('checkbox').first();
  if (await remember.isVisible().catch(() => false) && !(await remember.isChecked().catch(() => true))) await remember.check().catch(() => {});
  await dialog.locator('input[type="password"]').first().fill(password);
  await btn.click();
  await expect(btn).toBeHidden({ timeout: 30_000 });
  return true;
}

/**
 * Тишина первого запуска: на WebKit модалка «Выбери режим» и вопрос о
 * синхронизации приезжают и через 10 секунд после входа, а на телефоне тем же
 * временем стоит полноэкранный степпер (MC-6). Если спек начнёт действовать до
 * тишины, его первый клик упрётся в открытое окно, а автообработчик будет
 * зацикливаться на кнопке «Готово» этого окна.
 */
export async function waitForQuietDialogs(page: Page, budgetMs = 25_000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  let quiet = 0;
  while (Date.now() < deadline) {
    const visible = await page.locator(`[role="dialog"]${NOT_TOUR}, [data-testid="first-run-stepper"]`)
      .evaluateAll(els => els.filter(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).length)
      .catch(() => 0);
    if (visible === 0) {
      // 5 × 400 мс: окно синхронизации на медленном CI приходит и через ~1,5 с
      // после входа, три пустых проверки (1,2 с) его пропускали (CI 38600255832).
      if (++quiet >= 5) return true;
    } else {
      quiet = 0;
      await dismissFirstLoginDialogs(page, true, 6_000);
    }
    await page.waitForTimeout(400);
  }
  return false;
}

/** Вход и проход через окна первого запуска. */
export async function login(page: Page, u: Account, opts: { tour?: boolean } = {}): Promise<void> {
  if (!opts.tour) await suppressTour(page);
  await page.goto('/login');
  const email = page.locator('input[type="email"]');
  await email.waitFor({ state: 'visible', timeout: 20_000 }).catch(async () => {
    console.warn('[login] нет формы входа на', page.url(),
      (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').slice(0, 300));
  });
  await email.fill(u.email);
  await page.locator('input[type="password"]').fill(u.password);
  // Enter, а не клик: гость сидит на десктопном макете, курсор Playwright стоит
  // в (0,0) над боковой рейкой, Chromium считает это наведением — рейка
  // раскрывается на 220 px и закрывает центр «Войти» на 360 px (CI 38333345442).
  await page.locator('input[type="password"]').press('Enter');
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 90_000 });
  // N-5: дождаться собственной навигации приложения, иначе первый же goto спека
  // на WebKit прерывается и снимает весь проект.
  await waitForNavigationSettled(page);
  await dismissFirstLoginDialogs(page, true);
  if (!(await waitForQuietDialogs(page))) console.warn('[login] окно не закрылось за 25 с:', page.url());
  await unlockVaultIfAsked(page, u.password);
  await waitForMobileSettled(page, u.password);
}

/**
 * MC-6: очередь первого входа на телефоне держится, пока идут шаги степпера, и
 * после них приложение ещё догружается: право на мобильный макет приходит RPC,
 * ключ сейфа читается из IndexedDB, и в этом окне на экране мелькает и
 * десктопная рейка, и баннер «Сейф заперт — Открыть сейф». Спек, который
 * считает цели над полем сразу после входа, ловил именно этот переходный кадр.
 * therefore вход считается законченным, только когда мобильная оболочка
 * простояла без баннера и без окна разблокировки два цикла подряд.
 */
/**
 * N-5: сразу после входа приложение идёт само — на '/' (мастер приглашения,
 * «Писать»), а при смене аккаунта и вовсе перезагружает страницу. Спек, который
 * в этом окне делает свой `goto`, на WebKit ловит «page.goto: Navigation …
 * interrupted by another navigation to "/"» — на Chromium гонка успевает
 * разрешиться, поэтому набор падал только проектом Safari (~75 тестов).
 * Ждём, пока адрес перестанет меняться и загрузка закончится.
 */
export async function waitForNavigationSettled(page: Page, budgetMs = 20_000, quietMs = 800): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  let last = page.url();
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await page.waitForLoadState('load').catch(() => {});
    const now = page.url();
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= quietMs) {
      return true;
    }
    await page.waitForTimeout(120);
  }
  console.warn('[login] навигация после входа не устоялась за', budgetMs, 'мс — конец на', page.url());
  return false;
}

export async function waitForMobileSettled(page: Page, password: string, budgetMs = 25_000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  const nav = page.locator('[data-testid="mobile-bottom-nav"]');
  const banner = page.getByRole('button', { name: /^Открыть сейф$/ });
  let quiet = 0;
  while (Date.now() < deadline) {
    const unlocked = await unlockVaultIfAsked(page, password, 1_000);
    const opened = await openVaultFromBanner(page, password, 1_500);
    if (unlocked || opened) { quiet = 0; continue; }
    const bannerVisible = await banner.first().isVisible().catch(() => false);
    const navVisible = await nav.first().isVisible().catch(() => false);
    if (!bannerVisible && navVisible) {
      if (++quiet >= 2) return true;
    } else {
      quiet = 0;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

/** Лист «Выбери режим» после «Начать»: берём «Свободный поток». */
export async function pickFreeFlow(page: Page): Promise<boolean> {
  const opt = page.getByRole('button', { name: /Свободный поток/ }).or(page.getByText('Свободный поток')).first();
  if (await opt.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await opt.click();
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

/** Дзен включён по умолчанию; часть проверок делается с выключенным. */
export async function zenOff(page: Page): Promise<void> {
  await page.addInitScript(() => { try { localStorage.setItem('v2_zenModeEnabled', 'false'); } catch { /* приватный режим */ } });
}

export interface Overflow { scrollWidth: number; innerWidth: number; offenders: string[] }

export function horizontalOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        // Внутри своего прокручиваемого контейнера (тепловая карта в `overflow-x-auto`)
        // широкий элемент страницу не растягивает: считаем только то, что вылезло из самого контейнера.
        let clipped = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
            const ar = a.getBoundingClientRect();
            if (ar.left >= -1 && ar.right <= vw + 1) { clipped = true; break; }
          }
        }
        if (clipped) continue;
        const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : '';
        offenders.push(`${el.tagName.toLowerCase()}${cls} x=${Math.round(r.left)}..${Math.round(r.right)}`);
      }
    }
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, offenders: offenders.slice(0, 12) };
  });
}

export interface SmallTarget { label: string; w: number; h: number; cls: string }

export function smallTargets(page: Page, min = 44): Promise<SmallTarget[]> {
  return page.evaluate((limit) => {
    const out: { label: string; w: number; h: number; cls: string }[] = [];
    const sel = 'button, a, input[type="checkbox"], input[type="submit"], [role="button"]';
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // `sr-only` (skip-link) — 1×1 ровно потому, что он скрыт до фокуса:
      // целью касания он становится только в фокусе клавиатурой, и проверяется
      // отдельно. Считаем его по clip-path, а не по классу — класс может быть
      // собран иначе.
      const st = getComputedStyle(el);
      if (st.clipPath !== 'none' || /^rect\((0px|1px)/.test(st.clip)) continue;
      if (r.width >= limit && r.height >= limit) continue;
      // WCAG 2.5.8, исключение «inline»: ссылка внутри предложения размером не
      // обязана — её размер задаёт строка текста. Раздувать её полями нельзя:
      // поля соседних строк перекрывались и перехватывали касание (ревью 0.10.0).
      if (el.tagName === 'A' && st.display === 'inline'
        && (el.parentElement?.textContent ?? '').trim().length > (el.textContent ?? '').trim().length) continue;
      const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '')
        .trim().replace(/\s+/g, ' ').slice(0, 60);
      // Класс нужен, чтобы найти нарушителя в исходниках: метка-подпись часто
      // собирается из нескольких строк и по ней ничего не находится.
      const cls = (typeof el.className === 'string' ? el.className : '').trim().slice(0, 70);
      out.push({ label, w: Math.round(r.width), h: Math.round(r.height), cls });
    }
    return out.slice(0, 40);
  }, min);
}

export async function fullyInViewport(loc: Locator): Promise<boolean> {
  const box = await loc.boundingBox();
  if (!box) return false;
  const size = await loc.page().evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  return box.x >= -0.5 && box.y >= -0.5 && box.x + box.width <= size.w + 0.5 && box.y + box.height <= size.h + 0.5;
}

/** Снимок доказательства: <имя>-<проект>.png. */
export async function shot(page: Page, name: string): Promise<string> {
  mkdirSync(SHOTS, { recursive: true });
  const file = resolve(SHOTS, `${name}-${test.info().project.name.replace(/\s+/g, '')}.png`);
  await page.screenshot({ path: file });
  return file;
}

/**
 * Заглушка движка распознавания (из G-dictation.spec.ts аудита Fable): класс с
 * управляемыми из теста событиями. `window.__speech` считает start/stop/abort,
 * `window.__emit(kind, payload)` шлёт result/error/end.
 */
export const DICTATION_ENGINE = `(() => {
  window.__speech = { starts: 0, aborts: 0, stops: 0, log: [] };
  class R {
    constructor(){ this.continuous=false; this.interimResults=false; this.lang=''; window.__rec=this; }
    start(){ window.__speech.starts++; window.__speech.log.push('start'); setTimeout(()=>this.onstart&&this.onstart(),30); }
    stop(){ window.__speech.stops++; window.__speech.log.push('stop'); setTimeout(()=>this.onend&&this.onend(),60); }
    abort(){ window.__speech.aborts++; window.__speech.log.push('abort'); setTimeout(()=>{ this.onerror&&this.onerror({error:'aborted'}); this.onend&&this.onend(); },30); }
  }
  window.__emit = (kind, p) => { const r = window.__rec; if (!r) return 'no rec';
    if (kind==='result') { const list = p.items.map(it=>({isFinal:it.final,0:{transcript:it.text}})); list.length=p.items.length; r.onresult && r.onresult({ resultIndex: p.index ?? 0, results: list }); }
    else if (kind==='error') r.onerror && r.onerror({ error: p });
    else if (kind==='end') r.onend && r.onend();
    return 'ok'; };
  window.webkitSpeechRecognition = R; window.SpeechRecognition = R;
})();`;

/** Первый запуск диктовки у аккаунта с сейфом — окно «Голосовой ввод» с «Продолжить». */
export async function startDictation(page: Page): Promise<string> {
  const mic = page.getByRole('button', { name: /диктовк/i }).first();
  await mic.click();
  const dlg = page.getByRole('dialog').filter({ hasText: /Голосовой ввод/ }).first();
  const text = (await dlg.innerText({ timeout: 2_500 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
  // MF-5: на телефоне это лист с «Записать»; «Продолжить» осталось у окна десктопа.
  if (text) await dlg.getByRole('button', { name: /^(Записать|Продолжить)$/ }).click().catch(() => {});
  await page.waitForTimeout(400);
  return text;
}

export function emitSpeech(page: Page, kind: string, payload: unknown): Promise<string> {
  return page.evaluate(({ k, v }: { k: string; v: unknown }) => (window as unknown as { __emit: (k: string, v: unknown) => string }).__emit(k, v), { k: kind, v: payload });
}

export function speechCounters(page: Page): Promise<{ starts: number; aborts: number; stops: number; log: string[] }> {
  return page.evaluate(() => (window as unknown as { __speech: { starts: number; aborts: number; stops: number; log: string[] } }).__speech);
}

/**
 * Открывает сейф, если страница застала его запертым. Баннер «Сейф заперт —
 * синхронизация на паузе» на телефоне стоит в потоке (relative) и сдвигает весь
 * список вниз: спекам про геометрию макета нужен разблокированный сейф, иначе
 * первая строка меряется ниже, чем её нарисовал макет. Путь пользовательский —
 * кнопка «Открыть сейф» в самом баннере.
 */
export async function openVaultFromBanner(page: Page, password: string, settleMs = 8_000): Promise<boolean> {
  const open = page.getByRole('button', { name: /^Открыть сейф$/ }).first();
  // Ключ сессии мог восстановиться из кэша устройства: сначала даём баннеру уйти
  // самому, иначе клик открывает диалог разблокировки на пустом месте.
  const gone = await open.waitFor({ state: 'detached', timeout: settleMs }).then(() => true, () => false);
  if (gone) return false;
  await open.click();
  if (!(await unlockVaultIfAsked(page, password))) return false;
  await open.waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  return true;
}

/**
 * Вход без разблокировки сейфа: аккаунт с включённым шифрованием остаётся с
 * запертым сейфом, и баннер «Сейф заперт…» виден (так нужно проверке MB-8).
 */
/**
 * Запертый сейф = ключ устройства не сохранён. Галочка «Это моё устройство»
 * снимается в окне кода, но кэш ключей (`jw-keycache`, IndexedDB) чистим явно:
 * иначе прогон зависит от того, успел ли он сохраниться до этого шага.
 */
export async function clearDeviceKeyCache(page: Page, uid: string): Promise<void> {
  await page.evaluate(async (key: string) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open('jw-keycache', 1);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    try {
      await new Promise<void>((res, rej) => {
        const tx = db.transaction('keys', 'readwrite');
        tx.objectStore('keys').delete(key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error);
      });
    } finally { db.close(); }
  }, uid).catch(() => {});
}

export async function signInMobileLockedVault(page: Page, tag: string): Promise<Account> {
  const account = await createMobileAccount(tag);
  await autoHandlers(page, account.password, { autoUnlock: false });
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  // Enter, а не клик — см. login(): раскрытая рейка перекрывает «Войти».
  await page.locator('input[type="password"]').press('Enter');
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 90_000 });
  await waitForNavigationSettled(page);
  await dismissFirstLoginDialogs(page, true, 40_000, true);
  await clearDeviceKeyCache(page, account.uid);
  // Сейф, который не запоминали на устройстве, снова заперт только с новой
  // загрузки: ключ сессии живёт в памяти вкладки.
  await page.reload();
  await page.waitForTimeout(1_500);
  const cancel = page.getByRole('dialog').getByRole('button', { name: /^(Отмена|Cancel)$/i });
  if (await cancel.first().isVisible().catch(() => false)) await tap(cancel.first());
  return account;
}

export function standBaseUrl(): string {
  return standEnv().STAND_URL!;
}

/** Аккаунт с правом на мобильный макет + вход + окна первого запуска. */
export async function signInMobile(page: Page, tag: string): Promise<Account> {
  const account = await createMobileAccount(tag);
  await autoHandlers(page, account.password);
  await login(page, account);
  return account;
}

/**
 * N-7 (R7Q-036): геометрия, измеренная на экране ошибки, зелёная — у error
 * boundary нет ни кнопок касания, ни прокрутки, и `smallTargets` возвращает пустой
 * список, а `scrollWidth` равен ширине окна. Каждый замер обязан сначала
 * убедиться, что экран собрался: характерный контрол виден, текста аварии нет.
 */
export async function assertMobileScreenRendered(page: Page, path: string): Promise<void> {
  const text = await page.locator('body').innerText().catch(() => '');
  expect(
    /Что-то пошло не так|ERR-[0-9A-Za-z]/.test(text),
    `на ${path} вместо приложения экран аварии: ${text.replace(/\s+/g, ' ').slice(0, 160)}`,
  ).toBe(false);
  const markers: Record<string, string> = {
    '/': 'textarea',
    '/archive': 'h1, h2, [data-note-row]',
    '/ai': 'textarea, [data-testid="ai-chat"]',
    '/me': 'h1, h2',
  };
  const selector = markers[path] ?? 'h1, h2, textarea';
  await expect(
    page.locator(selector).first(),
    `на ${path} не появился ни один характерный контрол (${selector}) — экран не собрался`,
  ).toBeVisible({ timeout: 20_000 });
}
