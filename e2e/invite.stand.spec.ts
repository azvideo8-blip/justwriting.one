// V-1.4: мастер приглашения на стенде (scripts/stand/up.sh) — теми путями, которыми
// человек в него попадает: ссылка из письма, новая вкладка с политикой, повторное
// открытие ссылки и перезагрузка посреди настройки. Мера всех трёх — что
// приглашённый доводит мастер до конца и уходит в редактор с сейфом, а не с «ссылка
// уже использована» или с пустыми галочками.
//
// Почты на стенде нет: ссылка берётся из админ-API GoTrue (e2e/stand.ts), это тот
// же token_hash, что лежит в письме.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { generateLink, freshEmail, freshPassword } from './stand';

test.describe.configure({ mode: 'serial' });

const env = Object.fromEntries(
  readFileSync('scripts/stand/.env.stand', 'utf8').split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const REST = `${env.STAND_URL}/rest/v1`;

/** uid приглашённого: согласие пишется по нему, и это единственный ключ, который
 *  мастер оставляет в браузере до перехода в редактор. */
async function uidOf(page: Page): Promise<string> {
  const uid = await page.evaluate(() => {
    const k = Object.keys(localStorage).find(x => x.startsWith('privacy_accepted_'));
    return k ? k.slice('privacy_accepted_'.length) : null;
  });
  if (!uid) throw new Error('в браузере нет отметки согласия — мастер не доведён до конца');
  return uid;
}

/** Сейф — это encryption_meta в профиле; без него вход «без шифрования». */
async function vaultInCloud(uid: string): Promise<boolean> {
  const res = await fetch(`${REST}/users?select=encryption_meta&uid=eq.${uid}`, {
    headers: { apikey: env.SERVICE_KEY!, Authorization: `Bearer ${env.SERVICE_KEY}` },
  });
  const rows = (await res.json()) as Array<{ encryption_meta: unknown }>;
  return rows.length === 1 && rows[0]!.encryption_meta != null;
}

async function startWizard(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Добро пожаловать в justwriting' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByRole('heading', { name: 'Как мы обращаемся с данными' })).toBeVisible();
}

async function tickRequired(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: /Обязательно/ }).check();
}

async function toPasswordStep(page: Page): Promise<void> {
  await tickRequired(page);
  await page.getByRole('button', { name: 'Далее' }).click();
  await expect(page.getByRole('heading', { name: 'Придумайте пароль' })).toBeVisible();
}

async function setPassword(page: Page, password: string): Promise<void> {
  // 'Пароль' — подстрока 'Повторите пароль', поэтому точное имя.
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByLabel('Повторите пароль').fill(password);
  await page.getByRole('button', { name: 'Далее' }).click();
  // Сейф создаётся на этом же шаге: два прогона pbkdf2 по 600k итераций.
  await expect(page.getByRole('heading', { name: 'Хранить заметки в облаке?' })).toBeVisible({ timeout: 90_000 });
}

/** Открытая ссылка на политику — новая вкладка, а мастер остаётся на шаге. */
async function openPolicyInNewTab(page: Page): Promise<void> {
  const popupPromise = page.context().waitForEvent('page');
  await page.getByRole('link', { name: 'Политика конфиденциальности' }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/privacy/);
  await popup.close();
  await expect(page.getByRole('heading', { name: 'Как мы обращаемся с данными' })).toBeVisible();
}

test('1. ссылка → политика в новой вкладке → назад → пароль → готово: вход с сейфом', async ({ page }) => {
  const email = freshEmail('v1-1');
  const token = await generateLink('invite', email);
  await page.goto(`/reset-password?token_hash=${token}&type=invite`);

  await startWizard(page);
  await openPolicyInNewTab(page);
  await toPasswordStep(page);

  // V-1.1: перезагрузка посреди настройки не начинается заново.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Придумайте пароль' })).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('checkbox', { name: /Обязательно/ }).count()).toBe(0);
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page.getByRole('checkbox', { name: /Обязательно/ })).toBeChecked();

  const password = freshPassword();
  await page.getByRole('button', { name: 'Далее' }).click();
  await expect(page.getByRole('heading', { name: 'Придумайте пароль' })).toBeVisible();
  await setPassword(page, password);

  // Сейф создаётся на шаге пароля, код восстановления показывается здесь.
  await page.getByRole('button', { name: 'Включить' }).click();
  const code = page.getByText(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
  await expect(code).toBeVisible({ timeout: 30_000 });
  await page.getByRole('checkbox', { name: /Я сохранил/ }).check();
  await page.getByRole('button', { name: 'Начать писать' }).click();

  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 30_000 });
  const uid = await uidOf(page);
  expect(await vaultInCloud(uid)).toBe(true);
  expect(await page.evaluate(u => localStorage.getItem(`enc_enabled_${u}`), uid)).toBe('1');
});

test('2. ссылка открыта второй раз в новой вкладке → пароль → готово: вход с сейфом', async ({ context }) => {
  const email = freshEmail('v1-2');
  const token = await generateLink('invite', email);
  const first = await context.newPage();
  await first.goto(`/reset-password?token_hash=${token}&type=invite`);
  await startWizard(first);

  // Та же ссылка во второй вкладке: сессия в браузере одна, отметка обмена — тоже.
  const second = await context.newPage();
  await second.goto(`/reset-password?token_hash=${token}&type=invite`);
  await expect(second.getByRole('heading', { name: /Добро пожаловать в justwriting|Придумайте пароль/ })).toBeVisible({ timeout: 30_000 });
  await expect(second.getByText(/Эта ссылка-приглашение уже использована/)).toHaveCount(0);
  await expect(second.getByTestId('invite-switch-account')).toHaveCount(0);

  await startWizard(second);
  await toPasswordStep(second);
  await setPassword(second, freshPassword());
  await second.getByRole('button', { name: 'Не сейчас' }).click();

  await expect(second.locator('textarea').first()).toBeVisible({ timeout: 30_000 });
  const uid = await uidOf(second);
  expect(await vaultInCloud(uid)).toBe(true);
});

test('3. обмененная ссылка в свежем браузере говорит, где довести настройку', async ({ browser }) => {
  const email = freshEmail('v1-3');
  const token = await generateLink('invite', email);
  const first = await browser.newContext();
  const page1 = await first.newPage();
  await page1.goto(`/reset-password?token_hash=${token}&type=invite`);
  await startWizard(page1);
  await toPasswordStep(page1);
  await first.close();

  // Другой браузер: отметка обмена осталась там, человек попадает в тупик — и
  // должен получить подсказку, куда вернуться (V-1.2).
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto(`/reset-password?token_hash=${token}&type=invite`);
  await expect(page2.getByText(/Эта ссылка-приглашение уже использована/)).toBeVisible({ timeout: 30_000 });
  await expect(page2.getByText(/Если вы начали настройку в другом браузере/)).toBeVisible();
  await other.close();
});
