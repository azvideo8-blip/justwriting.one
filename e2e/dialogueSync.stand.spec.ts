import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createUser } from './stand';
import { readFileSync } from 'node:fs';

// S-38: два профиля браузера на стенде (scripts/stand/up.sh + api/server.ts с
// заглушкой ИИ) гоняют слияние диалогов S-29/S-34…S-37 вживую. Облачная строка
// у аккаунта с сейфом зашифрована, поэтому «что в облаке» читается двумя
// способами: сырая строка local_store_records (updatedAt, число страниц) и
// свежее третье устройство C, которое забирает облако в пустую базу.

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const env = Object.fromEntries(readFileSync('scripts/stand/.env.stand', 'utf8').split('\n').filter(Boolean).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const REST = `${env.STAND_URL}/rest/v1`;

interface Msg { id?: string; role: string; content: string; type?: string; variants?: string[]; variantIndex?: number; turnId?: string }
interface Dlg { id: string; title: string; messages: Msg[]; updatedAt: number; deletedMessages?: { id: string; at: number }[]; schema?: number; archived?: boolean }

async function cloudRows(uid: string): Promise<Array<{ key: string; updatedAt: number | null; pages: number }>> {
  const res = await fetch(`${REST}/local_store_records?user_id=eq.${uid}&store=eq.aiDialogues&select=key,payload`, {
    headers: { apikey: env.SERVICE_KEY!, Authorization: `Bearer ${env.SERVICE_KEY}` },
  });
  const rows = (await res.json()) as Array<{ key: string; payload: { updatedAt?: number; totalPages?: number } }>;
  const byKey = new Map<string, { key: string; updatedAt: number | null; pages: number }>();
  for (const r of rows) {
    const base = r.key.split('#')[0]!;
    const cur = byKey.get(base) ?? { key: base, updatedAt: null, pages: 0 };
    cur.pages += r.key.includes('#') ? 1 : 0;
    cur.updatedAt = typeof r.payload?.updatedAt === 'number' ? r.payload.updatedAt : cur.updatedAt;
    byKey.set(base, cur);
  }
  return [...byKey.values()];
}

async function dialogues(page: Page, uid: string): Promise<Dlg[]> {
  return page.evaluate(async (name) => {
    const dbs = await indexedDB.databases();
    if (!dbs.some(d => d.name === name)) return [];
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    try {
      if (!db.objectStoreNames.contains('aiDialogues')) return [];
      return await new Promise<Dlg[]>((res, rej) => { const r = db.transaction('aiDialogues').objectStore('aiDialogues').getAll(); r.onsuccess = () => res(r.result as Dlg[]); r.onerror = () => rej(r.error); });
    } finally { db.close(); }
  }, `justwriting-local-${uid}`);
}

async function putDialogue(page: Page, uid: string, d: Dlg): Promise<void> {
  await page.evaluate(async ({ name, d }) => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    try {
      await new Promise<void>((res, rej) => { const tx = db.transaction('aiDialogues', 'readwrite'); tx.objectStore('aiDialogues').put(d); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    } finally { db.close(); }
  }, { name: `justwriting-local-${uid}`, d });
}

const texts = (d: Dlg | undefined) => (d?.messages ?? []).filter(m => m.type !== 'system').map(m => m.content.replace(/\s+/g, ' ').slice(0, 40));

async function dismissFirstLoginDialogs(page: Page, syncOn: boolean): Promise<void> {
  const deadline = Date.now() + 30_000;
  let quiet = 0;
  while (Date.now() < deadline) {
    let acted = false; let open = false;
    for (const dialog of await page.getByRole('dialog').all()) {
      if (!(await dialog.isVisible().catch(() => false))) continue;
      open = true;
      for (const name of [/Я сохранил/, /Обязательно: Я прочитал/]) {
        const box = dialog.getByRole('checkbox', { name });
        if (await box.isVisible().catch(() => false) && !(await box.isChecked().catch(() => true))) await box.check({ timeout: 2_000 }).catch(() => {});
      }
      const sync = dialog.getByRole('button', { name: syncOn ? 'Включить синхронизацию' : 'Оставить выключенной' });
      const go = dialog.getByRole('button', { name: 'Продолжить' });
      if (await sync.isVisible().catch(() => false)) acted = (await sync.click({ timeout: 2_000 }).then(() => true, () => false)) || acted;
      else if (await go.isVisible().catch(() => false) && await go.isEnabled().catch(() => false)) acted = (await go.click({ timeout: 2_000 }).then(() => true, () => false)) || acted;
    }
    if (acted || open) { quiet = 0; await page.waitForTimeout(300); continue; }
    if (await page.locator('textarea').first().isVisible().catch(() => false) && ++quiet >= 3) return;
    await page.waitForTimeout(300);
  }
}

async function login(page: Page, u: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(u.email);
  await page.locator('input[type="password"]').fill(u.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await dismissFirstLoginDialogs(page, true);
  // Второе устройство того же аккаунта: вход поверх существующего сейфа может
  // спросить пароль от шифрования.
  await unlockVaultIfAsked(page, u.password);
}

/** Второе устройство: сейф заперт, модалка просит пароль аккаунта. */
async function unlockVaultIfAsked(page: Page, password: string, wait = 1_500): Promise<void> {
  const btn = page.getByRole('button', { name: 'Разблокировать', exact: true });
  if (!(await btn.isVisible({ timeout: wait }).catch(() => false))) return;
  const dialog = page.getByRole('dialog').filter({ has: btn });
  const remember = dialog.getByRole('checkbox').first();
  if (await remember.isVisible().catch(() => false) && !(await remember.isChecked().catch(() => true))) await remember.check().catch(() => {});
  await dialog.locator('input[type="password"]').first().fill(password);
  await btn.click();
  await expect(btn).toBeHidden({ timeout: 30_000 });
  console.warn('[vault] unlocked on demand');
}

async function grantAiConsent(page: Page): Promise<void> {
  // Секции настроек выбираются хэшем (SettingsPage); согласие на ИИ — в «security».
  await page.goto('/settings#security');
  const grant = page.getByRole('button', { name: 'Предоставить согласие' });
  const granted = page.getByText('Предоставлено').first();
  await expect(grant.or(granted).first()).toBeVisible({ timeout: 30_000 });
  if (await grant.isVisible().catch(() => false)) {
    await grant.click();
    await expect(granted).toBeVisible({ timeout: 15_000 });
  }
}

async function openChat(page: Page): Promise<void> {
  await page.goto('/ai');
  await unlockVaultIfAsked(page, user.password);
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 20_000 });
}

async function openDialogue(page: Page, title: string): Promise<void> {
  await openChat(page);
  await unlockVaultIfAsked(page, user.password);
  // Новое устройство могло ещё не забрать диалог из облака.
  await syncUntil(page, x => x.some(d => d.title.startsWith(title.slice(0, 18))), `диалог «${title.slice(0, 18)}» на устройстве`);
  const item = page.getByRole('button', { name: new RegExp(title.slice(0, 18).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.click();
}

let lastSendAt = 0;
const SEND_COOLDOWN_MS = 10_000; // «Слишком частые запросы. Подождите 8 сек.» — лимит на аккаунт, общий для устройств
/** Отправляет ход и ждёт ответа заглушки на него. */
async function sendTurn(page: Page, text: string): Promise<void> {
  await unlockVaultIfAsked(page, user.password);
  const box = page.locator('textarea').first();
  for (let attempt = 0; ; attempt++) {
    const wait = lastSendAt + SEND_COOLDOWN_MS - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    await box.fill(text);
    await box.press('Enter');
    lastSendAt = Date.now();
    // Принято — поле очищено; отказ (кулдаун) оставляет текст и показывает alert.
    const accepted = await expect.poll(() => box.inputValue(), { timeout: 5_000 }).toBe('').then(() => true, () => false);
    if (accepted) break;
    const alert = await page.getByRole('alert').allInnerTexts().catch(() => []);
    console.warn(`[sendTurn] не принято (попытка ${attempt + 1}):`, JSON.stringify(alert));
    if (attempt >= 3) throw new Error(`sendTurn: ход не принят: ${JSON.stringify(alert)}`);
    await page.getByRole('alert').getByRole('button', { name: 'Закрыть' }).first().click().catch(() => {});
    lastSendAt = Date.now();
  }
  const tail = text.slice(-60).replace(/\s+/g, ' ');
  await expect(page.getByText(new RegExp(`заглушки на: .*${tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)).first()).toBeVisible({ timeout: 60_000 });
  // Ответ на экране раньше, чем ход в базе: ждём саму запись (выгрузка идёт из неё).
  await expect.poll(async () => (await dialogues(page, user.uid)).some(d => d.messages.some(m => m.content.includes(text))), { timeout: 30_000, intervals: [500] }).toBe(true);
}

/** Фоновый проход (забор + выгрузка) стартует через 5 с после visibilitychange. */
async function pass(page: Page): Promise<void> {
  await unlockVaultIfAsked(page, user.password);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(7_000);
  await unlockVaultIfAsked(page, user.password);
}

async function waitFlushed(page: Page, uid: string, dialogueId: string): Promise<void> {
  await expect.poll(async () => {
    const local = (await dialogues(page, uid)).find(d => d.id === dialogueId);
    const cloud = (await cloudRows(uid)).find(r => r.key === dialogueId);
    // Облако не старше локальной копии: своя выгрузка прошла (чужая более поздняя — не ошибка).
    return local && cloud && (cloud.updatedAt ?? 0) >= local.updatedAt ? 'flushed' : `local=${local?.updatedAt} cloud=${cloud?.updatedAt}`;
  }, { timeout: 30_000, intervals: [1000] }).toBe('flushed');
}

async function regenerate(page: Page): Promise<void> {
  const lastAnswer = async () => {
    const d = (await dialogues(page, user.uid)).find(x => x.id === dlg.id);
    const m = [...(d?.messages ?? [])].reverse().find(x => x.role === 'assistant' && x.type !== 'system');
    return `${m?.content}|${m?.variants?.length ?? 0}`;
  };
  for (let attempt = 0; ; attempt++) {
    const wait = lastSendAt + SEND_COOLDOWN_MS - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    const before = await lastAnswer();
    await page.getByRole('button', { name: 'иначе' }).last().click();
    lastSendAt = Date.now();
    // Перегенерация записана, когда последний ответ в базе сменил текст или получил вариант.
    const changed = await expect.poll(lastAnswer, { timeout: 60_000, intervals: [1000] }).not.toBe(before).then(() => true, () => false);
    if (changed) break;
    const alert = await page.getByRole('alert').allInnerTexts().catch(() => []);
    console.warn(`[regenerate] не записано (попытка ${attempt + 1}):`, JSON.stringify(alert));
    if (attempt >= 2) throw new Error(`regenerate: не записано: ${JSON.stringify(alert)}`);
    await page.getByRole('alert').getByRole('button', { name: 'Закрыть' }).first().click().catch(() => {});
  }
  await page.waitForTimeout(1500);
}

/** Удаляет реплику с данным текстом через её кнопку «Удалить сообщение». */
async function deleteMessage(page: Page, text: string): Promise<void> {
  const bubble = page.getByText(text, { exact: true }).first().locator('xpath=ancestor::*[.//button[@aria-label="Удалить сообщение"]][1]');
  await bubble.hover().catch(() => {});
  await bubble.getByRole('button', { name: 'Удалить сообщение' }).first().click({ force: true });
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
    const buttons = await dialog.getByRole('button').all();
    await buttons[buttons.length - 1]!.click();
  }
  await page.waitForTimeout(1500);
}

interface Device { ctx: BrowserContext; page: Page }
let user: { email: string; password: string; uid: string };
let A: Device; let B: Device;
let dlg: Dlg;

async function device(context: BrowserContext, clockOffsetMs = 0): Promise<Device> {
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') console.warn(`[console.error] ${m.text().slice(0, 200)}`); });
  if (clockOffsetMs) await page.addInitScript((off) => { const real = Date.now; Date.now = () => real() + off; }, clockOffsetMs);
  await login(page, user);
  await grantAiConsent(page);
  await page.goto('/ai'); await unlockVaultIfAsked(page, user.password, 8_000);
  return { ctx: context, page };
}

/** Гоняет фоновые проходы, пока локальная база не удовлетворит условию (до 90 с). */
async function syncUntil(page: Page, pred: (ds: Dlg[]) => boolean, label: string): Promise<Dlg[]> {
  const deadline = Date.now() + 90_000;
  let ds = await dialogues(page, user.uid);
  while (!pred(ds) && Date.now() < deadline) {
    await pass(page);
    ds = await dialogues(page, user.uid);
  }
  if (!pred(ds)) console.warn(`[syncUntil] ${label}: не дождались, диалоги:`, JSON.stringify(ds.map(d => [d.id, texts(d)])));
  return ds;
}

async function freshDeviceView(browser: import('@playwright/test').Browser, dialogueId: string): Promise<Dlg | undefined> {
  const ctx = await browser.newContext();
  const C = await device(ctx);
  await openChat(C.page);
  const ds = await syncUntil(C.page, x => x.some(d => d.id === dialogueId), 'устройство C');
  const d = ds.find(x => x.id === dialogueId);
  await ctx.close();
  return d;
}

test.beforeAll(async ({ browser }) => {
  user = await createUser('s38');
  A = await device(await browser.newContext());
  B = await device(await browser.newContext());
});

test('1. concurrent append on A and B without a pull in between — both turns in the cloud row after each flush', async ({ browser }) => {
  await openChat(A.page);
  await sendTurn(A.page, 'Общий вопрос первый');
  dlg = (await dialogues(A.page, user.uid))[0]!;
  await waitFlushed(A.page, user.uid, dlg.id);
  await openChat(B.page);
  await syncUntil(B.page, x => x.some(d => d.id === dlg.id), 'B получает диалог');
  await openDialogue(B.page, dlg.title);
  expect(texts((await dialogues(B.page, user.uid)).find(d => d.id === dlg.id))).toHaveLength(2);

  // Оба пишут, не забирая чужое: B первым, A вторым (у A в базе нет хода B).
  const snap = async (tag: string, page: Page) => {
    const all = await dialogues(page, user.uid);
    const c = (await cloudRows(user.uid)).find(r => r.key === dlg.id);
    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map(d => d.name));
    const guest = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('justwriting-local'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      try { if (!db.objectStoreNames.contains('aiDialogues')) return 'no store'; return await new Promise<number>((res) => { const r = db.transaction('aiDialogues').objectStore('aiDialogues').count(); r.onsuccess = () => res(r.result); }); } finally { db.close(); }
    });
    console.warn(`[1:${tag}] dbs=${JSON.stringify(dbs)} guestDialogues=${guest} cloud(${dlg.id.slice(0, 8)}) updatedAt=${c?.updatedAt} local=${JSON.stringify(all.map(d => [d.id.slice(0, 8), d.updatedAt, texts(d)]))}`);
  };
  await sendTurn(B.page, 'Вопрос с устройства B');
  await snap('B after turn', B.page);
  await waitFlushed(B.page, user.uid, dlg.id);
  await snap('B flushed', B.page);
  await sendTurn(A.page, 'Вопрос с устройства A');
  await snap('A after turn', A.page);
  await waitFlushed(A.page, user.uid, dlg.id);
  await snap('A flushed', A.page);
  await snap('B now', B.page);

  const cloud = await freshDeviceView(browser, dlg.id);
  const t = texts(cloud);
  console.warn('[1] облако после двух выгрузок:', JSON.stringify(t));
  expect(t.filter(x => x.includes('устройства B'))).toHaveLength(1);
  expect(t.filter(x => x.includes('устройства A'))).toHaveLength(1);
  expect(t).toHaveLength(6);

  const six = (x: Dlg[]) => texts(x.find(d => d.id === dlg.id)).length === 6;
  expect(six(await syncUntil(A.page, six, 'A видит 6'))).toBe(true);
  expect(six(await syncUntil(B.page, six, 'B видит 6'))).toBe(true);
});

test('2. B wrote a turn offline > 1 h ago; A online pulled within 30 min — the union reaches A after B returns; A’s next turn does not erase it', async () => {
  // Офлайн-ход нельзя получить от ИИ, поэтому его записывает тест: прямо в базу B,
  // с отметками двухчасовой давности — как если бы устройство писало давно и
  // только сейчас вышло в сеть.
  await B.ctx.setOffline(true);
  const stale = (await dialogues(B.page, user.uid)).find(d => d.id === dlg.id)!;
  const at = Date.now() - 2 * 3600_000;
  const qid = `off_${at.toString(36)}_q`;
  stale.messages.push(
    { id: qid, role: 'user', content: 'Ход B в офлайне', createdAt: at } as Msg,
    { id: `${qid}_a`, role: 'assistant', content: 'Офлайн-ответ B', createdAt: at + 1, turnId: qid } as Msg,
  );
  stale.updatedAt = at + 1;
  await putDialogue(B.page, user.uid, stale);

  await sendTurn(A.page, 'Ход A пока B в офлайне');
  await waitFlushed(A.page, user.uid, dlg.id);
  await pass(A.page);
  const aPullBefore = await A.page.evaluate((k) => localStorage.getItem(k), `ai_pull_since_${user.uid}`);

  await B.ctx.setOffline(false);
  await B.page.reload(); await openDialogue(B.page, dlg.title);
  // Новый ход B онлайн: выгрузка сливает локальную копию (с офлайн-ходом) с облаком.
  await sendTurn(B.page, 'Ход B снова в сети');
  await waitFlushed(B.page, user.uid, dlg.id);
  const cloud = (await cloudRows(user.uid)).find(r => r.key === dlg.id)!;
  console.warn('[2] отметка союза в облаке', cloud.updatedAt, 'последний забор A', aPullBefore);
  expect(cloud.updatedAt!).toBeGreaterThan(Number(aPullBefore) - 30 * 60_000);

  console.warn('[2] B после выгрузки:', JSON.stringify(texts((await dialogues(B.page, user.uid)).find(d => d.id === dlg.id))));
  const hasOff = (x: Dlg[]) => texts(x.find(d => d.id === dlg.id)).some(t => t === 'Ход B в офлайне');
  let a = await syncUntil(A.page, hasOff, 'A видит офлайн-ход B');
  console.warn('[2] A после забора:', JSON.stringify(texts(a.find(d => d.id === dlg.id))));
  expect(hasOff(a)).toBe(true);

  await sendTurn(A.page, 'Следующий ход A');
  await waitFlushed(A.page, user.uid, dlg.id);
  const hasNext = (x: Dlg[]) => texts(x.find(d => d.id === dlg.id)).some(t => t.includes('Следующий ход A'));
  const b = await syncUntil(B.page, hasNext, 'B видит следующий ход A');
  a = await dialogues(A.page, user.uid);
  const ta = texts(a.find(d => d.id === dlg.id)); const tb = texts(b.find(d => d.id === dlg.id));
  expect(ta.some(x => x === 'Ход B в офлайне')).toBe(true);
  expect(ta.some(x => x === 'Офлайн-ответ B')).toBe(true);
  expect(ta).toEqual(tb);
});

test('3. sign out B between its upload and its next pull — B’s turn survives in the cloud and reaches A', async ({ browser }) => {
  await openDialogue(B.page, dlg.title);
  await sendTurn(B.page, 'Последний ход B перед выходом');
  await waitFlushed(B.page, user.uid, dlg.id);
  await B.page.goto('/settings');
  await B.page.getByRole('button', { name: 'Выйти', exact: true }).first().click();
  const dialog = B.page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Выйти/ }).click();
  await B.page.waitForURL(/login/, { timeout: 20_000 }).catch(() => {});
  await pass(A.page);
  const a = texts((await dialogues(A.page, user.uid)).find(d => d.id === dlg.id));
  expect(a.some(x => x.includes('перед выходом'))).toBe(true);
  // B возвращается как новое устройство.
  await B.ctx.close();
  B = await device(await browser.newContext());
  await openChat(B.page);
  const same = (x: Dlg[]) => JSON.stringify(texts(x.find(d => d.id === dlg.id))) === JSON.stringify(a);
  const b = texts((await syncUntil(B.page, same, 'новое устройство B получает всё')).find(d => d.id === dlg.id));
  expect(b).toEqual(a);
});

test('7. the same turn regenerated on both devices; regenerate on A while B appends', async () => {
  await openDialogue(A.page, dlg.title);
  await openDialogue(B.page, dlg.title);
  const before = texts((await dialogues(A.page, user.uid)).find(d => d.id === dlg.id));
  await regenerate(A.page);
  await waitFlushed(A.page, user.uid, dlg.id);
  await regenerate(B.page);
  await waitFlushed(B.page, user.uid, dlg.id);
  const converged = async () => {
    // Проходы на обоих, пока копии не сойдутся (до 2 мин).
    const key = async (page: Page) => JSON.stringify(texts((await dialogues(page, user.uid)).find(d => d.id === dlg.id)));
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await pass(A.page); await pass(B.page);
      if ((await key(A.page)) === (await key(B.page))) return;
    }
    console.warn('[converged] копии не сошлись: A=', await key(A.page), 'B=', await key(B.page));
  };
  await converged();
  const a = (await dialogues(A.page, user.uid)).find(d => d.id === dlg.id)!;
  const b = (await dialogues(B.page, user.uid)).find(d => d.id === dlg.id)!;
  console.warn('[7] A:', JSON.stringify(texts(a)), 'варианты последнего:', a.messages.at(-1)?.variants?.length);
  expect(texts(a)).toHaveLength(before.length);
  expect(texts(b)).toHaveLength(before.length);
  expect(texts(a).filter(x => x === before.at(-2))).toHaveLength(1);
  expect((a.messages.at(-1)?.variants?.length ?? 0)).toBeGreaterThanOrEqual(2);
  expect(a.messages.at(-1)?.variants).toEqual(b.messages.at(-1)?.variants);

  // Перегенерация на A одновременно с новым ходом на B.
  // «Одновременно» для слияния значит «без забора между действиями»; настоящую
  // одновременность запрещает кулдаун отправок на аккаунт (10 с).
  await regenerate(A.page);
  await sendTurn(B.page, 'Новый ход B во время перегенерации на A');
  await waitFlushed(A.page, user.uid, dlg.id);
  await waitFlushed(B.page, user.uid, dlg.id);
  await converged();
  const a2 = texts((await dialogues(A.page, user.uid)).find(d => d.id === dlg.id));
  const b2 = texts((await dialogues(B.page, user.uid)).find(d => d.id === dlg.id));
  console.warn('[7b] A:', JSON.stringify(a2));
  expect(a2).toEqual(b2);
  expect(a2).toHaveLength(before.length + 2);
  expect(a2.indexOf(a2.find(x => x.includes('во время перегенерации'))!)).toBe(before.length);
});

test('11. delete on A; B, still holding the message, appends — the message must not come back', async () => {
  await openDialogue(A.page, dlg.title);
  const before = (await dialogues(A.page, user.uid)).find(d => d.id === dlg.id)!;
  const victim = before.messages.find(m => m.content === 'Вопрос с устройства B')!;
  await deleteMessage(A.page, victim.content);
  // Сначала убеждаемся, что удаление вообще записано локально (иначе это промах харнесса, не слияния).
  const gone = await expect.poll(async () => {
    const d = (await dialogues(A.page, user.uid)).find(x => x.id === dlg.id);
    return !d?.messages.some(m => m.id === victim.id);
  }, { timeout: 15_000 }).toBe(true).then(() => true, () => false);
  const afterDel = (await dialogues(A.page, user.uid)).find(x => x.id === dlg.id);
  console.warn('[11] удалено локально:', gone, 'victim:', victim.id, victim.content.slice(0, 30), 'deletedMessages:', JSON.stringify(afterDel?.deletedMessages), 'texts:', JSON.stringify(texts(afterDel)));
  expect(gone, 'удаление через UI не записалось — харнесс').toBe(true);
  await waitFlushed(A.page, user.uid, dlg.id);
  await openDialogue(B.page, dlg.title);
  await sendTurn(B.page, 'Ход B после удаления на A');
  await waitFlushed(B.page, user.uid, dlg.id);
  await pass(A.page); await pass(B.page); await pass(A.page);
  const a = (await dialogues(A.page, user.uid)).find(d => d.id === dlg.id)!;
  const b = (await dialogues(B.page, user.uid)).find(d => d.id === dlg.id)!;
  expect(a.messages.some(m => m.id === victim.id), 'удалённая реплика вернулась на A').toBe(false);
  expect(b.messages.some(m => m.id === victim.id), 'удалённая реплика вернулась на B').toBe(false);
  expect(texts(a)).toEqual(texts(b));
});

test('9. delete a middle message on A, switch the last answer’s variant on B, sync both ways twice', async () => {
  await openDialogue(B.page, dlg.title);
  await regenerate(B.page);
  await waitFlushed(B.page, user.uid, dlg.id);
  await pass(A.page);
  await openDialogue(A.page, dlg.title);
  await deleteMessage(A.page, 'Ход B снова в сети');
  // Листание варианта на B — предыдущий вариант.
  const prev = B.page.locator('button:has(svg.lucide-chevron-left)').last();
  if (await prev.isVisible().catch(() => false)) await prev.click();
  await B.page.waitForTimeout(1500);
  await waitFlushed(A.page, user.uid, dlg.id);
  await waitFlushed(B.page, user.uid, dlg.id);
  for (let i = 0; i < 2; i++) { await pass(A.page); await pass(B.page); }
  const a = (await dialogues(A.page, user.uid)).find(d => d.id === dlg.id)!;
  const b = (await dialogues(B.page, user.uid)).find(d => d.id === dlg.id)!;
  console.warn('[9] A:', JSON.stringify(texts(a)), 'B:', JSON.stringify(texts(b)));
  expect(texts(a)).toEqual(texts(b));
  expect(a.messages.at(-1)?.variantIndex).toBe(b.messages.at(-1)?.variantIndex);
});

test('14. rename on A while B chats', async () => {
  await openDialogue(A.page, dlg.title);
  const newTitle = `Переименовано ${Date.now().toString(36)}`;
  // Переименование через шапку чата (карандаш → поле «Название диалога» → Enter).
  await A.page.getByRole('button', { name: 'Переименовать' }).first().click();
  const title = A.page.getByLabel('Название диалога').first();
  await expect(title).toBeVisible({ timeout: 10_000 });
  await title.fill(newTitle); await title.press('Enter');
  await expect.poll(async () => (await dialogues(A.page, user.uid)).find(x => x.id === dlg.id)?.title, { timeout: 10_000 }).toBe(newTitle);
  await sendTurn(B.page, 'Ход B пока A переименовывает');
  await waitFlushed(B.page, user.uid, dlg.id);
  await waitFlushed(A.page, user.uid, dlg.id).catch(() => {});
  for (let i = 0; i < 2; i++) { await pass(A.page); await pass(B.page); }
  const a = (await dialogues(A.page, user.uid)).find(d => d.id === dlg.id)!;
  const b = (await dialogues(B.page, user.uid)).find(d => d.id === dlg.id)!;
  console.warn('[14] titles', a.title, '|', b.title);
  expect(texts(a)).toEqual(texts(b));
  expect(texts(a).some(x => x.includes('переименовывает'))).toBe(true);
  expect(a.title).toBe(b.title);
  dlg = a;
});

test('12. B’s clock +1 day — order and no loss', async ({ browser }) => {
  const Bfast = await device(await browser.newContext(), 24 * 3600_000);
  await openDialogue(Bfast.page, dlg.title);
  await sendTurn(Bfast.page, 'Ход с часов, ушедших на сутки вперёд');
  await waitFlushed(Bfast.page, user.uid, dlg.id);
  await openDialogue(A.page, dlg.title);
  await sendTurn(A.page, 'Ход A с нормальных часов');
  await waitFlushed(A.page, user.uid, dlg.id);
  await pass(A.page); await pass(Bfast.page); await pass(A.page);
  const a = texts((await dialogues(A.page, user.uid)).find(d => d.id === dlg.id));
  const b = texts((await dialogues(Bfast.page, user.uid)).find(d => d.id === dlg.id));
  console.warn('[12] A:', JSON.stringify(a));
  expect(a).toEqual(b);
  expect(a.some(x => x.includes('на сутки'))).toBe(true);
  expect(a.some(x => x.includes('нормальных часов'))).toBe(true);
  await Bfast.ctx.close();
});

test('8. pre-update dialogue (no ids, with variants): switch variant on A, chat on B, sync', async () => {
  const legacy: Dlg = {
    id: `legacy_${Date.now().toString(36)}`, title: 'Старый диалог до обновления',
    messages: [
      { role: 'user', content: 'Старый вопрос один' }, { role: 'assistant', content: 'Старый ответ один' },
      { role: 'user', content: 'Старый вопрос два' }, { role: 'assistant', content: 'вариант Б', variants: ['вариант А', 'вариант Б'], variantIndex: 1 },
    ],
    updatedAt: Date.now() - 3600_000,
  };
  (legacy as unknown as { personaId: string; createdAt: number }).personaId = (dlg as unknown as { personaId: string }).personaId;
  (legacy as unknown as { createdAt: number }).createdAt = Date.now() - 7200_000;
  await putDialogue(A.page, user.uid, legacy);
  await putDialogue(B.page, user.uid, legacy);
  await A.page.reload(); await openDialogue(A.page, legacy.title);
  const prev = A.page.locator('button:has(svg.lucide-chevron-left)').last();
  await expect(prev).toBeVisible({ timeout: 10_000 });
  await prev.click();
  await A.page.waitForTimeout(1500);
  await B.page.reload(); await openDialogue(B.page, legacy.title);
  await sendTurn(B.page, 'Новый ход в старом диалоге');
  await waitFlushed(A.page, user.uid, legacy.id);
  await waitFlushed(B.page, user.uid, legacy.id);
  for (let i = 0; i < 2; i++) { await pass(A.page); await pass(B.page); }
  const a = (await dialogues(A.page, user.uid)).find(d => d.id === legacy.id)!;
  const b = (await dialogues(B.page, user.uid)).find(d => d.id === legacy.id)!;
  console.warn('[8] A:', JSON.stringify(texts(a)), 'B:', JSON.stringify(texts(b)));
  expect(texts(a)).toEqual(texts(b));
  expect(texts(a)).toHaveLength(6);
  expect(a.messages[3]?.content).toBe('вариант А');
  expect(b.messages[3]?.content).toBe('вариант А');
});

test('16. paged dialogue (> 500 KB) syncs through the page path', async () => {
  const big: Dlg = {
    id: `big_${Date.now().toString(36)}`, title: 'Большой диалог',
    messages: [{ role: 'user', content: 'Большой вопрос' }, { role: 'assistant', content: 'Ы'.repeat(600_000) }],
    updatedAt: Date.now() - 60_000,
  };
  (big as unknown as { personaId: string; createdAt: number }).personaId = (dlg as unknown as { personaId: string }).personaId;
  (big as unknown as { createdAt: number }).createdAt = Date.now() - 120_000;
  await putDialogue(A.page, user.uid, big);
  await A.page.reload(); await openDialogue(A.page, big.title);
  await sendTurn(A.page, 'Дописываем в большой диалог');
  await expect.poll(async () => (await cloudRows(user.uid)).find(r => r.key === big.id)?.pages ?? 0, { timeout: 60_000 }).toBeGreaterThan(1);
  await pass(B.page);
  const b = (await dialogues(B.page, user.uid)).find(d => d.id === big.id);
  expect(texts(b)).toHaveLength(4);

});

test('15. delete the whole dialogue on A while B appends', async () => {
  await openDialogue(A.page, dlg.title);
  await openDialogue(B.page, dlg.title);
  const del = A.page.getByRole('button', { name: 'Удалить', exact: true }).first();
  await expect(del).toBeVisible({ timeout: 10_000 });
  await del.click();
  { const dialog = A.page.getByRole('dialog'); if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) { const bs = await dialog.getByRole('button').all(); await bs[bs.length - 1]!.click(); } }
  await sendTurn(B.page, 'Ход B пока A удаляет диалог');
  await pass(A.page); await pass(B.page); await pass(A.page); await pass(B.page);
  const a = (await dialogues(A.page, user.uid)).find(d => d.id === dlg.id);
  const b = (await dialogues(B.page, user.uid)).find(d => d.id === dlg.id);
  const rows = (await cloudRows(user.uid)).find(r => r.key === dlg.id);
  console.warn('[15] A has:', !!a, 'B has:', !!b, 'cloud row:', !!rows, 'B texts:', JSON.stringify(texts(b)));
  expect(!!a).toBe(!!b);
});
