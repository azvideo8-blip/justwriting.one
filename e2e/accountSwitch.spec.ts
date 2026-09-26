// F-3: живой сквозной сценарий смены аккаунта на локальном стенде (scripts/stand/up.sh).
// Никакого прода: свои GoTrue/PostgREST/Postgres в docker, пользователи и ссылки
// создаются на каждый прогон через админ-API с сгенерированными значениями.
import { test, expect, type Page } from '@playwright/test';
import { createUser, generateLink, freshEmail, freshPassword } from './stand';

// Сценарии независимы (у каждого свои пользователи), но GoTrue один — по одному.
test.describe.configure({ mode: 'default' });

// Навигации и ошибки консоли — в вывод: по ним разбирается падение в CI.
test.beforeEach(async ({ context }) => {
  let n = 0;
  context.on('page', page => {
    const tab = ++n;
    page.on('framenavigated', f => { if (f === page.mainFrame()) console.warn(`[nav tab${tab}] ${f.url()}`); });
    page.on('console', m => { if (m.type() === 'error') console.warn(`[console.error] ${m.text().slice(0, 300)}`); });
  });
});

const marker = (tag: string) => `MARKER-${tag}-${Date.now().toString(36)}`;

/** Метка «эта страница ещё не перезагружалась»: пропадает только с новой загрузкой документа. */
async function stamp(page: Page): Promise<void> {
  await page.evaluate(() => { (window as unknown as { __jwStamp?: number }).__jwStamp = 1; });
}
async function expectReloaded(page: Page): Promise<void> {
  // Разрушенный контекст посреди evaluate — это и есть перезагрузка.
  const read = () => page.evaluate(() => (window as unknown as { __jwStamp?: number }).__jwStamp ?? null).catch(() => null);
  await expect.poll(read, { timeout: 15_000 }).toBeNull();
}

/** Окна после первого входа: код восстановления сейфа, политика, вопрос о синхронизации. */
async function dismissFirstLoginDialogs(page: Page): Promise<void> {
  const deadline = Date.now() + 30_000;
  let quiet = 0;
  while (Date.now() < deadline) {
    let acted = false;
    let open = false;
    // Окна лежат друг на друге; действие по перекрытому окну висело бы до
    // таймаута теста — поэтому действия короткие, неудача = следующий круг.
    for (const dialog of await page.getByRole('dialog').all()) {
      if (!(await dialog.isVisible().catch(() => false))) continue;
      open = true;
      for (const name of [/Я сохранил/, /Обязательно: Я прочитал/]) {
        const box = dialog.getByRole('checkbox', { name });
        if (await box.isVisible().catch(() => false) && !(await box.isChecked().catch(() => true))) {
          await box.check({ timeout: 2_000 }).catch(() => {});
        }
      }
      const keepOff = dialog.getByRole('button', { name: 'Оставить выключенной' });
      const go = dialog.getByRole('button', { name: 'Продолжить' });
      if (await keepOff.isVisible().catch(() => false)) acted = (await keepOff.click({ timeout: 2_000 }).then(() => true, () => false)) || acted;
      else if (await go.isVisible().catch(() => false) && await go.isEnabled().catch(() => false)) acted = (await go.click({ timeout: 2_000 }).then(() => true, () => false)) || acted;
    }
    if (acted || open) { quiet = 0; await page.waitForTimeout(300); continue; }
    if (await page.locator('textarea').first().isVisible().catch(() => false) && ++quiet >= 3) return;
    await page.waitForTimeout(300);
  }
  const left = await page.evaluate(() => Array.from(document.querySelectorAll('[role=dialog]')).map(d => (d as HTMLElement).innerText.slice(0, 80)));
  console.warn('[dialogs] не закрылись:', JSON.stringify(left));
}

async function login(page: Page, u: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  const email = page.locator('input[type="email"]');
  // /login при открытой сессии уводит на «/» — в выводе будет видно, куда попали.
  await email.waitFor({ state: 'visible', timeout: 20_000 }).catch(async () => {
    console.warn('[login] нет формы входа на', page.url(), (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').slice(0, 400));
  });
  await email.fill(u.email);
  await page.locator('input[type="password"]').fill(u.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await dismissFirstLoginDialogs(page);
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 15_000 });
}

/** Набор прячет шапку с «Сохранено» (дзен), а сам значок живёт секунду — ждём
 *  не значок, а сам черновик в базе аккаунта: это и есть «сохранено». */
async function typeAndWaitSaved(page: Page, uid: string, text: string): Promise<void> {
  const editor = page.locator('textarea').first();
  await editor.click();
  await editor.fill(text);
  await expect.poll(() => dumpLocalDb(page, uid), { timeout: 20_000 }).toContain(text);
}

async function signOut(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Выйти', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await stamp(page);
  await dialog.getByRole('button', { name: /Выйти/ }).click();
}

/** Всё, что видно человеку: редактор, архив, метки, журнал. */
async function visibleTextEverywhere(page: Page): Promise<string> {
  let text = '';
  for (const path of ['/', '/archive', '/settings']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(500);
    text += `\n${await page.evaluate(() => document.body.innerText)}`;
  }
  await page.goto('/');
  const journal = page.getByRole('button', { name: 'Журнал активности' });
  if (await journal.isVisible().catch(() => false)) {
    await journal.click();
    await page.waitForTimeout(300);
    text += `\n${await page.evaluate(() => document.body.innerText)}`;
  }
  return text;
}

/** Все записи базы аккаунта в браузере одной строкой. */
async function dumpLocalDb(page: Page, uid: string): Promise<string> {
  return page.evaluate(async (name) => {
    const dbs = await indexedDB.databases();
    if (!dbs.some(d => d.name === name)) return '';
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const out: unknown[] = [];
    for (const store of Array.from(db.objectStoreNames)) {
      const rows = await new Promise<unknown[]>((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      out.push({ store, rows });
    }
    db.close();
    return JSON.stringify(out);
  }, `justwriting-local-${uid}`);
}

test('1. выход: перезагрузка страницы, /login и тост', async ({ page }) => {
  const A = await createUser('a1');
  await login(page, A);
  await typeAndWaitSaved(page, A.uid, `Текст А. ${marker('A1')}`);

  await signOut(page);
  await expectReloaded(page);
  await page.waitForURL('**/login', { timeout: 15_000 });
  await expect(page.getByText('Вы вышли из аккаунта')).toBeVisible({ timeout: 10_000 });
});

test('2. вход другим: ничего от A ни на экране, ни в базе B', async ({ page }) => {
  const A = await createUser('a2');
  const B = await createUser('b2');
  const mark = marker('A2');
  await login(page, A);
  await typeAndWaitSaved(page, A.uid, `Дневник А. ${mark}`);
  await signOut(page);
  await page.waitForURL('**/login', { timeout: 15_000 });

  await login(page, B);
  await expect(page.locator('textarea').first()).not.toHaveValue(new RegExp(mark));
  expect(await visibleTextEverywhere(page)).not.toContain(mark);
  expect(await dumpLocalDb(page, B.uid)).not.toContain(mark);
});

/** A вошёл, открывает приглашение для C: вопрос → «Продолжить» → перезагрузка → мастер до шага пароля. */
async function inviteOverOpenAccount(page: Page): Promise<void> {
  const A = await createUser('a3');
  await login(page, A);
  const token = await generateLink('invite', freshEmail('c3'));

  await stamp(page);
  await page.goto(`/reset-password?token_hash=${token}&type=invite`);
  const ask = page.getByTestId('invite-switch-account');
  await expect(ask).toBeVisible({ timeout: 15_000 });
  await expect(ask).toContainText('Сейчас выполнен вход');
  await ask.getByRole('button', { name: 'Продолжить' }).click();

  await expectReloaded(page);
  await expect(page.getByRole('heading', { name: 'Добро пожаловать в justwriting' })).toBeVisible({ timeout: 20_000 });
  // Сразу после обмена ссылки приходит событие входа, и мастер перемонтируется
  // на шаг «welcome»; клик в этот зазор теряется — человек нажал бы ещё раз.
  await expect(async () => {
    await page.getByRole('button', { name: 'Начать' }).click();
    await expect(page.getByRole('heading', { name: 'Как мы обращаемся с данными' })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole('checkbox', { name: /Обязательно/ }).check();
  await page.getByRole('button', { name: 'Далее' }).click();
  await expect(page.getByRole('heading', { name: 'Придумайте пароль' })).toBeVisible();
}

test('3. приглашение при открытом аккаунте: вопрос → перезагрузка → мастер; обновление без «ссылка устарела» и без повторного вопроса', async ({ page }) => {
  await inviteOverOpenAccount(page);

  await page.reload();
  await expect(page.locator('input[type="password"]')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByText('Ссылка уже использована или устарела')).toHaveCount(0);
  await expect(page.getByTestId('invite-switch-account')).toHaveCount(0);
});

// Отчёт F-3, находка 1: после обновления страницы на шаге пароля мастер не
// возвращается — вместо него форма «Восстановление пароля» с предупреждением
// о заметках, зашифрованных прежним паролем (у приглашённого их нет).
// Причина: после обмена ссылки адрес чистится до /reset-password, и `type=invite`
// не переживает перезагрузку. Владелец решит; тест намеренно красный.
test('3b. после обновления страницы приглашённый остаётся в мастере (известная находка)', async ({ page }) => {
  test.fail();
  await inviteOverOpenAccount(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Добро пожаловать в justwriting|Придумайте пароль/ })).toBeVisible({ timeout: 20_000 });
});

test('4. две вкладки: смена аккаунта во второй перезагружает первую, текст A остаётся у A и не попадает к B', async ({ context }) => {
  const A = await createUser('a4');
  const B = await createUser('b4');
  const mark = marker('A4');
  const tab1 = await context.newPage();
  await login(tab1, A);
  const tab2 = await context.newPage();
  await tab2.goto('/');
  await expect(tab2.locator('textarea').first()).toBeVisible({ timeout: 20_000 });

  // Вкладка 1 пишет и не ждёт сохранения дольше секунды.
  await tab1.locator('textarea').first().fill(`Черновик А. ${mark}`);
  await stamp(tab1);

  // Сессия в браузере одна: /login при открытом аккаунте ведёт на «/», поэтому
  // вход B во второй вкладке начинается с выхода там же.
  await signOut(tab2);
  await tab2.waitForURL('**/login', { timeout: 15_000 });
  await expectReloaded(tab1);
  await login(tab2, B);

  await expect(tab1.locator('textarea').first()).not.toHaveValue(new RegExp(mark), { timeout: 15_000 });
  expect(await dumpLocalDb(tab2, B.uid)).not.toContain(mark);
  expect(await dumpLocalDb(tab1, B.uid)).not.toContain(mark);

  await tab2.close();
  await signOut(tab1);
  await tab1.waitForURL('**/login', { timeout: 15_000 });
  await login(tab1, A);
  await expect(tab1.locator('textarea').first()).toHaveValue(new RegExp(mark), { timeout: 15_000 });
  expect(await dumpLocalDb(tab1, B.uid)).not.toContain(mark);
});

test('5. восстановление пароля: новый пароль → «Пароль изменён» после перезагрузки', async ({ page }) => {
  const C = await createUser('c5');
  const token = await generateLink('recovery', C.email);
  await page.goto(`/reset-password?token_hash=${token}&type=recovery`);
  const fields = page.locator('input[type="password"]');
  await expect(fields).toHaveCount(2, { timeout: 20_000 });
  const next = freshPassword();
  await fields.nth(0).fill(next);
  await fields.nth(1).fill(next);
  await stamp(page);
  await page.locator('button[type="submit"]').click();

  await expectReloaded(page);
  await expect(page.getByText('Пароль изменён')).toBeVisible({ timeout: 15_000 });
  await login(page, { email: C.email, password: next });
});
