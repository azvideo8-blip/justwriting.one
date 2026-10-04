import { test, expect, type Page, type BrowserContext, type Request, type Response } from '@playwright/test';
import { createUser } from './stand';
import { readFileSync } from 'node:fs';

// S-38: два профиля браузера на стенде (scripts/stand/up.sh + api/server.ts с
// заглушкой ИИ) гоняют слияние диалогов S-29/S-34…S-37 вживую. Облачная строка
// у аккаунта с сейфом зашифрована, поэтому «что в облаке» читается двумя
// способами: сырая строка local_store_records (updatedAt, число страниц) и
// свежее третье устройство C, которое забирает облако в пустую базу.

test.describe.configure({ mode: 'serial' });
test.setTimeout(420_000);

const env = Object.fromEntries(readFileSync('scripts/stand/.env.stand', 'utf8').split('\n').filter(Boolean).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const REST = `${env.STAND_URL}/rest/v1`;

interface Msg { id?: string; role: string; content: string; type?: string; variants?: string[]; variantIndex?: number; turnId?: string }
interface Dlg { id: string; title: string; messages: Msg[]; updatedAt: number; deletedMessages?: { id: string; at: number }[]; schema?: number; archived?: boolean; personaId?: string; responseLength?: string; lastExtractedMessageId?: string }

async function cloudRows(uid: string): Promise<Array<{ key: string; updatedAt: number | null; pages: number; pointer: boolean; segmented: boolean }>> {
  const res = await fetch(`${REST}/local_store_records?user_id=eq.${uid}&store=eq.aiDialogues&select=key,payload`, {
    headers: { apikey: env.SERVICE_KEY!, Authorization: `Bearer ${env.SERVICE_KEY}` },
  });
  const rows = (await res.json()) as Array<{ key: string; payload: { updatedAt?: number; totalPages?: number } }>;
  const byKey = new Map<string, { key: string; updatedAt: number | null; pages: number; pointer: boolean; segmented: boolean }>();
  for (const r of rows) {
    // Дочерние строки записи: страницы `key#…` (0.9.28 и прочие сторы) и сегменты
    // `key@seg…` (M-5).
    const at = r.key.indexOf('@seg');
    const base = at < 0 ? r.key.split('#')[0]! : r.key.slice(0, at);
    const cur = byKey.get(base) ?? { key: base, updatedAt: null, pages: 0, pointer: false, segmented: false };
    if (r.key === base) cur.pointer = true;
    else cur.pages += 1;
    if (at >= 0) cur.segmented = true;
    // Отметкой версии для сегментной копии является head, а не окно: иначе
    // осиротевшие строки оборванной попытки выглядят как «выгрузка прошла».
    if (r.key === base || !cur.segmented) {
      cur.updatedAt = typeof r.payload?.updatedAt === 'number' ? r.payload.updatedAt : cur.updatedAt;
    } else if (cur.pointer) {
      const h = rows.find(x => x.key === base)?.payload?.updatedAt;
      cur.updatedAt = typeof h === 'number' ? h : cur.updatedAt;
    }
    byKey.set(base, cur);
  }
  return [...byKey.values()];
}

/** Сырое облачное состояние диалога — то, что требует печатать тикет M-6:
 *  отметка версии, ключи страниц, есть ли манифест. У аккаунта без сейфа
 *  печатается и содержимое строк, у аккаунта с сейфом — только его размер:
 *  шифротекст в логе бесполезен, а выдуманный текст дневника в логе — нет. */
async function cloudDetail(uid: string, dialogueId: string, label: string, vaultless = false): Promise<void> {
  const res = await fetch(`${REST}/local_store_records?user_id=eq.${uid}&store=eq.aiDialogues&select=key,payload`, {
    headers: { apikey: env.SERVICE_KEY!, Authorization: `Bearer ${env.SERVICE_KEY}` },
  });
  const all = (await res.json()) as Array<{ key: string; payload: Record<string, unknown> }>;
  const rows = all.filter(r => r.key === dialogueId || r.key.startsWith(`${dialogueId}#`) || r.key.startsWith(`${dialogueId}@seg`));
  rows.sort((a, b) => a.key.localeCompare(b.key));
  const brief = rows.map((r) => {
    const p = r.payload;
    const manifest = p.manifest === true;
    const head = p.head === true;
    const seg = p.seg === true;
    const base: Record<string, unknown> = {
      key: r.key.slice(dialogueId.length) || '(row)',
      updatedAt: p.updatedAt,
      ...(typeof p.totalPages === 'number' ? { totalPages: p.totalPages } : {}),
      ...(typeof p.page === 'number' ? { page: p.page } : {}),
      ...(typeof p.firstAt === 'number' ? { firstAt: p.firstAt } : {}),
      ...(manifest ? { manifest: true } : {}),
      ...(head ? { head: true, windows: Array.isArray(p.segments) ? p.segments.length : null } : {}),
      ...(seg ? { seg: true } : {}),
      ...(typeof p.nonce === 'string' ? { nonce: p.nonce } : {}),
    };
    if (vaultless) base.head = JSON.stringify(p.data ?? p.chunk ?? p.messages ?? null).slice(0, 80);
    else if (typeof p.data === 'string') base.dataBytes = p.data.length;
    else if (typeof p.chunk === 'string') base.chunkBytes = p.chunk.length;
    else if (typeof p.messages === 'string') base.messagesBytes = p.messages.length;
    return base;
  });
  console.warn(`[cloud ${label}] ${dialogueId.slice(0, 8)}: ${JSON.stringify(brief)}`);
}

/** Считает точные совпадения: подстрока ловит и вопрос, и ответ-эхо заглушки. */
const countText = (list: string[], exact: string) => list.filter((x) => x === exact).length;

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

async function login(page: Page, u: { email: string; password: string }, base = ''): Promise<void> {
  await page.goto(base + '/login');
  await page.locator('input[type="email"]').fill(u.email);
  await page.locator('input[type="password"]').fill(u.password);
  await page.locator('button[type="submit"]').click();
  // 90 с вместо 30: стенд живёт на ноутбуке, который занят посторонними процессами,
  // и вход (pbkdf2 600k + два чанка + первый забор) при конкуренции за CPU не
  // укладывается в полминуты. Это ограничение машины, а не приложения.
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 90_000 });
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
  // Согласие живёт на аккаунте, не на устройстве: на сборке другого тега
  // (0.9.28/0.9.29) секция может выглядеть иначе — поэтому проверяем не надпись,
  // а факт в базе (см. aiConsentGranted ниже).
  await expect(grant.or(granted).first()).toBeVisible({ timeout: 30_000 }).catch(() => {
    console.warn('[consent] секция согласия не найдена — проверяю согласие по базе');
  });
  if (await grant.isVisible().catch(() => false)) {
    // force/dispatchEvent: под нагрузкой кнопки настроек дёргаются анимациями, и
    // обычный клик ждёт «стабильности» минутами (так упали прогоны 12-го сценария).
    await grant.click({ force: true, timeout: 15_000 }).catch(() => grant.dispatchEvent('click'));
    await expect(granted).toBeVisible({ timeout: 20_000 });
  }
  // Молчаливое «считаю, что дано» стоило прогона: без согласия API отвечает
  // 403 AI_CONSENT_REQUIRED, а тест видит «ход не принят» и падает по таймауту,
  // где это выглядит как сломанная синхронизация (так упал сценарий 8).
  await expect.poll(() => aiConsentGranted(user.uid), { timeout: 30_000, intervals: [1_000] }).toBe(true);
}

/** Истина согласия — столбец профиля: UI старого билда может выглядеть иначе. */
async function aiConsentGranted(uid: string): Promise<boolean> {
  const res = await fetch(`${REST}/users?uid=eq.${uid}&select=ai_consent_at,ai_consent_version`, {
    headers: { apikey: env.SERVICE_KEY!, Authorization: `Bearer ${env.SERVICE_KEY}` },
  });
  const rows = (await res.json()) as Array<{ ai_consent_at: string | null; ai_consent_version?: number | null }>;
  const granted = rows.length > 0 && rows[0]!.ai_consent_at !== null;
  if (!granted) console.warn('[consent] в базе согласия пока нет:', JSON.stringify(rows[0] ?? null));
  return granted;
}

async function openChat(page: Page, base = ''): Promise<void> {
  await page.goto(base + '/ai');
  await unlockVaultIfAsked(page, user.password);
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 20_000 });
}

async function openDialogue(page: Page, title: string, base = ''): Promise<void> {
  await openChat(page, base);
  await unlockVaultIfAsked(page, user.password);
  // Новое устройство могло ещё не забрать диалог из облака.
  await syncUntil(page, x => x.some(d => d.title.startsWith(title.slice(0, 18))), `диалог «${title.slice(0, 18)}» на устройстве`);
  const item = page.getByRole('button', { name: new RegExp(title.slice(0, 18).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.click();
}

let lastSendAt = 0;
// Шаг между отправками. Серверный кулдаун считается по ПОСЛЕДНЕМУ AI-запросу
// аккаунта, а на один ход их 2–3 (чат, автоименование, память), поэтому шаг
// «интервал между ходами» систематически меньше реального окна: ретраи съедали таймаут теста.
const SEND_COOLDOWN_MS = 12_000; // реальный межзапросный кулдаун сервера — 8 с
/** Отправляет ход и дожидается, пока он лег в локальную базу.
 *  Ответа модели НЕ ждёт: сценарию «забор посреди стрима» нужен незавершённый стрим.
 *
 *  Факт принятия — запись в IndexedDB, а не первый ответ эндпоинта. Прежний
 *  матчинг «любой /api/chat* с статусом < 400» ловил отказ автоименования
 *  (`/api/chatWithAI`, 429 «Daily limit reached.») как отказ самого хода: ход
 *  был принят и отвечен (видно на снимке страницы), а харнесс уходил во вторую
 *  попытку и висел на `fill` до таймаута теста — так падал сценарий 8 в очереди. */
async function startTurn(page: Page, text: string): Promise<void> {
  await unlockVaultIfAsked(page, user.password);
  const box = page.locator('textarea').first();
  const recorded = async () => (await dialogues(page, user.uid)).some(d => d.messages.some(m => m.content.includes(text)));
  for (let attempt = 0; ; attempt++) {
    // Отказы собираем со всех AI-эндпоинтов, но относимся к ним как к контексту:
    // 429 от служебного вызова (именование, память) ход не отменяет.
    const rejects: string[] = [];
    const onResponse = (r: Response) => {
      const p = new URL(r.url()).pathname;
      if (!p.startsWith('/api/chat')) return;
      if (r.status() < 400) return;
      rejects.push(`${p} ${r.status()}${r.headers()['retry-after'] ? ` (Retry-After=${r.headers()['retry-after']})` : ''}`);
    };
    page.on('response', onResponse);
    let sent = false;
    const onRequest = (r: Request) => { if (r.url().includes('/api/chat')) sent = true; };
    page.on('request', onRequest);
    const wait = lastSendAt + SEND_COOLDOWN_MS - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    // `fill` без ограничения ждётactionability до конца таймаута теста: во время
    // генерации композера нет на экране, и молчаливое висение стоило очереди
    // семь минут на одном шаге.
    try {
      await box.fill(text, { timeout: 20_000 });
      await box.press('Enter');
    } catch (e) {
      const dialogs = (await page.getByRole('dialog').allInnerTexts().catch(() => [])).join(' | ').slice(0, 160);
      console.warn(`[startTurn] поле ввода недоступно (попытка ${attempt + 1}): ${String(e).slice(0, 120)} · url=${page.url()} · dialogs="${dialogs}"`);
      page.off('request', onRequest); page.off('response', onResponse);
      if (attempt >= 4) throw new Error(`startTurn: нет поля ввода за 5 попыток (url=${page.url()}, dialogs="${dialogs}")`);
      await page.waitForTimeout(3_000);
      continue;
    }
    lastSendAt = Date.now();
    // Ждём записи хода в базу (она появляется, только когда запрос принят).
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !(await recorded())) await page.waitForTimeout(1_000);
    const accepted = await recorded();
    page.off('request', onRequest);
    page.off('response', onResponse);
    if (accepted) {
      if (rejects.length) console.warn(`[startTurn] ход принят, но в попытке были отказы: ${rejects.join(', ')}`);
      return;
    }
    const alert = (await page.getByRole('alert').allInnerTexts().catch(() => [])).join(' ');
    const clientCooldown = await page.evaluate(() => localStorage.getItem('jw_ai_cooldown_until')).catch(() => null);
    console.warn(`[startTurn] ход не в базе (попытка ${attempt + 1}): запрос${sent ? 'ушёл' : 'НЕ УШЁЛ'} · отказы: ${rejects.join(', ') || 'нет'} · alert="${alert.slice(0, 80)}" · jw_ai_cooldown_until=${clientCooldown ?? '?'}`);
    if (attempt >= 4) throw new Error(`startTurn: ход не принят за 5 попыток · отказы: ${rejects.join(', ') || 'нет'} · alert="${alert.slice(0, 120)}"`);
    // Серверный кулдаун (10 с на аккаунт) приходит с Retry-After — ждём ровно
    // столько, сколько просит сервер, вместо слепых повторов.
    const retryAfter = Math.max(0, ...rejects.map(x => Number(/Retry-After=(\d+)/.exec(x)?.[1] ?? 0)));
    if (retryAfter > 0) { await page.waitForTimeout(retryAfter * 1_000 + 500); lastSendAt = 0; }
    await page.getByRole('alert').getByRole('button', { name: 'Закрыть' }).first().click().catch(() => {});
  }
}

/** Ход записан в локальную базу (выгрузка идёт из неё, а не с экрана). */
async function waitTurnRecorded(page: Page, text: string): Promise<void> {
  await expect.poll(async () => (await dialogues(page, user.uid)).some(d => d.messages.some(m => m.content.includes(text))), { timeout: 60_000, intervals: [500] }).toBe(true);
}

/** Отправляет ход и ждёт ответа заглушки на него. */
async function sendTurn(page: Page, text: string): Promise<void> {
  await startTurn(page, text);
  const tail = text.replace(/\[(slow|memory-delay)\]/g, '').slice(-60).replace(/\s+/g, ' ');
  await expect(page.getByText(new RegExp(`заглушки на: .*${tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)).first()).toBeVisible({ timeout: 90_000 });
  // Ответ на экране раньше, чем ход в базе: ждём саму запись (выгрузка идёт из неё).
  await waitTurnRecorded(page, text);
}

/** Фоновый проход (забор + выгрузка) стартует через 5 с после visibilitychange. */
async function pass(page: Page): Promise<void> {
  await unlockVaultIfAsked(page, user.password);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(3_500);
  await unlockVaultIfAsked(page, user.password, 500);
  await page.waitForTimeout(3_500);
  await unlockVaultIfAsked(page, user.password);
}

/** Сырое состояние записи диалога: есть ли указатель, какие сегменты он называет,
 *  какие строки лежат в облаке и остались ли страницы прежнего формата. */
async function cloudSegmentState(uid: string, id: string): Promise<{ pointer: boolean; named: string[]; segKeys: string[]; legacyKeys: string[] }> {
  const res = await fetch(`${REST}/local_store_records?user_id=eq.${uid}&store=eq.aiDialogues&select=key,payload`, {
    headers: { apikey: env.SERVICE_KEY!, Authorization: `Bearer ${env.SERVICE_KEY}` },
  });
  const rows = (await res.json()) as Array<{ key: string; payload: Record<string, unknown> }>;
  const head = rows.find(r => r.key === id && r.payload.head === true);
  const named = head ? ((head.payload.segments as Array<{ key: string }> | undefined) ?? []).map(s => s.key) : [];
  return {
    pointer: head !== undefined,
    named,
    segKeys: rows.filter(r => r.key.startsWith(`${id}@seg`)).map(r => r.key),
    legacyKeys: rows.filter(r => r.key.startsWith(`${id}#`)).map(r => r.key),
  };
}

async function waitFlushed(page: Page, uid: string, dialogueId: string): Promise<void> {
  await expect.poll(async () => {
    // Запоздавший запрос сейфа (на старых профилях он всплывает через 10–20 с)
    // снимается здесь же: иначе «облако пусто» означает запертый ключ, а не
    // сломанное слияние.
    await unlockVaultIfAsked(page, user.password, 300);
    const local = (await dialogues(page, uid)).find(d => d.id === dialogueId);
    const cloud = (await cloudRows(uid)).find(r => r.key === dialogueId);
    // M-5: для сегментной копии фактом выгрузки считается наличие head'а: строки
    // окон сами по себе диалогом не являются (их пишет тот же проход, что и
    // указатель, но указатель — последний).
    if (local && cloud?.segmented && !cloud.pointer) return 'segments without head';
    // Облако не старше локальной копии: своя выгрузка прошла (чужая более поздняя — не ошибка).
    return local && cloud && (cloud.updatedAt ?? 0) >= local.updatedAt ? 'flushed' : `local=${local?.updatedAt} cloud=${cloud?.updatedAt}`;
  }, { timeout: 30_000, intervals: [1000] }).toBe('flushed');
  // Требование M-6: после каждой выгрузки — сырая облачная строка.
  await cloudDetail(uid, dialogueId, `flush с ${await page.evaluate(() => location.origin)}`);
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

async function device(context: BrowserContext, clockOffsetMs = 0, base = '', vault = true): Promise<Device> {
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') console.warn(`[console.error] ${m.text().slice(0, 200)}`); });
  if (clockOffsetMs) await page.addInitScript((off) => { const real = Date.now; Date.now = () => real() + off; }, clockOffsetMs);
  if (vault) await login(page, user, base); else await loginWithoutVault(page, base);
  // Флаг автосинхронизации живёт в localStorage КАЖДОГО origin: диалог первого
  // входа, который его включает, показывается один раз на аккаунт и только там,
  // где аккаунт создан. Профиль старого клиента (:3101/:3102) этого диалога не
  // видел, поэтому фоновая выгрузка на «старом устройстве» была выключена не
  // продуктом, а руками, которых на нём не было. Включаем так, как это сделал
  // бы пользователь, — и только если ключ отсутствует.
  const flagSet = await page.evaluate((uid) => {
    const k = `auto_sync_enabled_${uid}`;
    if (localStorage.getItem(k) !== null) return false;
    localStorage.setItem(k, 'true');
    return true;
  }, user.uid);
  if (flagSet) console.warn(`[sync] включил автосинхронизацию на origin ${base || '(свой)'} — ключ был пуст`);
  await grantAiConsent(page);
  await page.goto(base + '/ai'); await unlockVaultIfAsked(page, user.password, 8_000);
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

/** Диалог-затравка: позволяет гонять новые сценарии отдельно от базовых
 *  (-g "4\."), не дожидаясь 11 прогонов подряд. В полном прогоне dlg уже задан
 *  тестом 1, и хелпер — no-op. */
async function ensureSeed(): Promise<void> {
  if (dlg !== undefined) return;
  await openChat(A.page);
  await sendTurn(A.page, 'Общий вопрос первый');
  dlg = (await dialogues(A.page, user.uid))[0]!;
  await waitFlushed(A.page, user.uid, dlg.id);
  await openChat(B.page);
  await syncUntil(B.page, x => x.some(d => d.id === dlg.id), 'B получает диалог');
}

// ── Сценарии M-6, которых не было в S-38 ────────────────────────────────
// Четыре из них в S-38 не гонялись именно из-за харнесса: заглушка возвращала
// пустую память (5, 17), не было способа подгадать момент стрима (4), не было
// сборки старого тега на том же стенде (10) и аккаунта без сейфа (13). Заглушка
// (scripts/stand/ai-stub.mjs) умеет и непустую память, и растянутый стрим.

const OLD_029 = process.env.STAND_OLD_029 ?? 'http://localhost:3101';
const OLD_028 = process.env.STAND_OLD_028 ?? 'http://localhost:3102';

/** Вход без сейфа: модалка «Настрой шифрование» отклоняется, синхронизация
 *  включается. Такой аккаунт кладёт облачные строки открытым текстом — это и
 *  проверяет сценарий «аккаунт без сейфа». */
async function loginWithoutVault(page: Page, base = ''): Promise<void> {
  await page.goto(base + '/login');
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  const enc = page.getByRole('button', { name: 'Включить шифрование' });
  if (await enc.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(enc).toBeHidden({ timeout: 10_000 });
    console.warn('[vaultless] сейф не заводим: модалка закрыта без создания ключа');
  } else {
    console.warn('[vaultless] модалка шифрования не появилась');
  }
  await dismissFirstLoginDialogs(page, true);
}

/** Смена объёма ответа через шапку чата. */
async function setResponseLength(page: Page, label: 'Кратко' | 'Обычно' | 'Объёмно'): Promise<void> {
  await page.getByTitle('Настройки объема вывода').click();
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(800);
}

/** Переключение собеседника через dropdown в шапке. */
async function switchPersona(page: Page): Promise<string> {
  const btn = page.locator('button:has(svg.lucide-chevron-down)').first();
  const activeName = (await btn.innerText()).trim();
  await btn.click();
  const before = (await dialogues(page, user.uid)).find(d => d.id === dlg.id)?.personaId;
  const items = page.locator('div.absolute.left-0 button:has(span)');
  const names = await items.allInnerTexts();
  // Иначе кликаем НЕ активную персону: первый пункт списка — она же, и смена
  // собралась бы в no-op, который тест выглядел бы пройденным.
  const idx = names.findIndex(x => x.trim() !== '' && x.trim() !== activeName);
  const chosen = names[idx] ?? '';
  if (idx < 0) throw new Error('switchPersona: другой персоны в списке нет, активна «' + activeName + '»');
  await items.nth(idx).click();
  await page.waitForTimeout(2_000);
  const after = (await dialogues(page, user.uid)).find(d => d.id === dlg.id)?.personaId;
  console.warn('[persona] ' + activeName + ' → ' + chosen.trim() + ' (id ' + before + ' → ' + after + ')');
  if (after === before) throw new Error('switchPersona: personaId не изменился — смена собеседника не записана');
  return after ?? '';
}

/** Значения полей диалога, которые слияние обязано сохранять. */
const flagsOf = (d: Dlg | undefined) => JSON.stringify({ persona: d?.personaId, len: d?.responseLength, upd: d?.updatedAt, cursor: d?.lastExtractedMessageId });

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
  await cloudDetail(user.uid, dlg.id, '1 после выгрузки B');
  await sendTurn(A.page, 'Вопрос с устройства A');
  await snap('A after turn', A.page);
  await waitFlushed(A.page, user.uid, dlg.id);
  await snap('A flushed', A.page);
  await cloudDetail(user.uid, dlg.id, '1 после выгрузки A');
  await snap('B now', B.page);

  const cloud = await freshDeviceView(browser, dlg.id);
  const t = texts(cloud);
  console.warn('[1] облако после двух выгрузок:', JSON.stringify(t));
  expect(countText(t, 'Вопрос с устройства B')).toBe(1);
  expect(countText(t, 'Вопрос с устройства A')).toBe(1);
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
  const hasNext = (x: Dlg[]) => countText(texts(x.find(d => d.id === dlg.id)), 'Следующий ход A') === 1;
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
  expect(countText(a, 'Последний ход B перед выходом')).toBe(1);
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
  expect(a2.indexOf('Новый ход B во время перегенерации на A')).toBe(before.length);
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
  expect(countText(texts(a), 'Ход B пока A переименовывает')).toBe(1);
  expect(a.title).toBe(b.title);
  dlg = a;
});

test('8. pre-update dialogue (no ids, with variants): switch variant on A, chat on B, sync', async () => {
  // `dlg` наполняется в ensureSeed: без него тест годен только в цепочке, а
  // одиночный прогон падал на `undefined.personaId` ещё до M-5.
  await ensureSeed();
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

test('16. dialogue > 500 KB syncs as head + segments (was: page path)', async () => {
  // Как и 8: `dlg` появляется в ensureSeed, без него тест годен только в цепочке.
  await ensureSeed();
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

test('4. забор в другой вкладке того же устройства, пока стрим ещё дописывается', async () => {
  await ensureSeed();
  await openDialogue(A.page, dlg.title);
  const before = (await dialogues(A.page, user.uid)).find(d => d.id === dlg.id)!;
  const beforeCount = before.messages.length;

  // Маркер [slow] растягивает ответ заглушки на ~16 с (8 чанков по 2 с): окно,
  // в котором ход ещё не записан в базу, достаточно длинное, чтобы успеть забор.
  await startTurn(A.page, 'Ход с долгим стримом [slow]');
  const tab2 = await A.ctx.newPage();
  await tab2.goto('/ai');
  await unlockVaultIfAsked(tab2, user.password);
  await pass(tab2);
  await pass(tab2);
  console.warn('[4] забор во второй вкладке сделан, стрим ещё может идти');

  await expect(A.page.getByText(/заглушки на: Ход с долгим стримом/).first()).toBeVisible({ timeout: 90_000 });
  await waitTurnRecorded(A.page, 'Ход с долгим стримом');
  await tab2.close();

  const after = (await dialogues(A.page, user.uid)).find(d => d.id === dlg.id)!;
  const answer = after.messages.filter(m => m.role === 'assistant' && m.content.includes('Ход с долгим стримом'));
  console.warn('[4] A:', JSON.stringify({ beforeCount, now: after.messages.length, answers: answer.length, полные: answer.map(m => m.content.length) }));
  expect(answer, 'ответ после стрима не записан').toHaveLength(1);
  expect(answer[0]!.content.length, 'ответ обрезан забором в другой вкладке').toBeGreaterThan(30);
  expect(countText(texts(after), 'Ход с долгим стримом [slow]')).toBe(1);

  await waitFlushed(A.page, user.uid, dlg.id);
  const hasSlow = (x: Dlg[]) => texts(x.find(d => d.id === dlg.id)).includes('Ход с долгим стримом [slow]');
  const b = await syncUntil(B.page, hasSlow, 'B видит ход с долгим стримом');
  expect(hasSlow(b), 'ход со стрима не дошёл до B').toBe(true);
  expect(texts(b.find(d => d.id === dlg.id))).toEqual(texts(after));
});

test('5. удаление хода на A и ход на B, пока извлекается память', async () => {
  test.setTimeout(480000);
  await ensureSeed();
  await openDialogue(A.page, dlg.title);
  await openDialogue(B.page, dlg.title);

  // Извлечение памяти — каждый 3-й ход сессии, поэтому ловим запрос: ходим
  // кругами, пока вкладка не отправит extractChatMemory. Маркер в тексте
  // задерживает ответ заглушки на 12 с — окно, в котором и правим диалог.
  let victim = '';
  for (let attempt = 1; attempt <= 6; attempt++) {
    const marker = `Ход для извлечения памяти ${attempt} [memory-delay]`;
    const reqSeen = A.page.waitForRequest(r => r.url().includes('extractChatMemory'), { timeout: 45_000 }).then(() => true, () => false);
    await sendTurn(A.page, marker);
    if (await reqSeen) { victim = marker; console.warn(`[5] извлечение памяти началось на попытке ${attempt}`); break; }
    console.warn(`[5] попытки ${attempt}: extractChatMemory не ушёл (счётчик сессии не кратен 3)`);
  }
  expect(victim, 'за 6 ходов извлечение памяти ни разу не началось').not.toBe('');

  // Работаем в окне извлечения: удаляем предыдущий ход на A и дописываем на B.
  const d = (await dialogues(A.page, user.uid)).find(x => x.id === dlg.id)!;
  const toDelete = d.messages.filter(m => m.role === 'user' && m.content !== victim && !m.content.includes('[memory-delay]')).at(-1);
  if (toDelete?.content) await deleteMessage(A.page, toDelete.content);
  await sendTurn(B.page, 'Ход B во время извлечения памяти');

  // Ждём, пока память допишется (задержка + запись), и даём пройти выгрузкам.
  await A.page.waitForTimeout(15_000);
  for (let i = 0; i < 2; i++) { await pass(A.page); await pass(B.page); }
  await waitFlushed(A.page, user.uid, dlg.id);
  await cloudDetail(user.uid, dlg.id, '5 после правок во время извлечения памяти');

  const a = (await dialogues(A.page, user.uid)).find(d2 => d2.id === dlg.id)!;
  const b = (await dialogues(B.page, user.uid)).find(d2 => d2.id === dlg.id)!;
  console.warn('[5] курсор памяти:', a.lastExtractedMessageId, '| A:', JSON.stringify(texts(a)), '| удалён:', toDelete?.content);
  expect(a.messages.some(m => m.id === a.lastExtractedMessageId), 'курсор памяти указывает на несуществующее сообщение').toBe(true);
  if (toDelete?.id) expect(a.messages.some(m => m.id === toDelete.id), 'удалённый ход воскрес на A').toBe(false);
  expect(countText(texts(b), 'Ход B во время извлечения памяти')).toBe(1);
  expect(texts(a)).toEqual(texts(b));
  dlg = a;
});

test('6. перегенерация после смены объёма ответа и собеседника', async () => {
  await ensureSeed();
  await openDialogue(A.page, dlg.title);
  await setResponseLength(A.page, 'Кратко');
  const personaAfter = await switchPersona(A.page);
  await waitFlushed(A.page, user.uid, dlg.id);

  await openDialogue(B.page, dlg.title);
  await regenerate(A.page);
  await sendTurn(B.page, 'Ход B во время смены настроек');
  await waitFlushed(A.page, user.uid, dlg.id);
  await waitFlushed(B.page, user.uid, dlg.id);
  // Ждём схождения по скалярным полям, а не двух проходов: сравнение после
  // фиксированного числа проходов меряло бы скорость фоновой синхронизации.
  { const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const x = flagsOf((await dialogues(A.page, user.uid)).find(d => d.id === dlg.id));
      const y = flagsOf((await dialogues(B.page, user.uid)).find(d => d.id === dlg.id));
      if (x === y) break;
      await pass(A.page); await pass(B.page);
    } }
  await cloudDetail(user.uid, dlg.id, '6 после смены объёма/персоны');

  const a = (await dialogues(A.page, user.uid)).find(d => d.id === dlg.id)!;
  const b = (await dialogues(B.page, user.uid)).find(d => d.id === dlg.id)!;
  console.warn('[6] флаги A:', flagsOf(a), '| B:', flagsOf(b));
  expect(countText(texts(a), 'Ход B во время смены настроек')).toBe(1);
  expect(texts(a)).toEqual(texts(b));
  // Варианты живут у перегенерированного ответа, а хвост диалога — уже ход B.
  const withVariants = a.messages.filter(m => (m.variants?.length ?? 0) >= 2);
  expect(withVariants.length, 'перегенерация не оставила варианты').toBeGreaterThanOrEqual(1);
  expect(a.personaId).toBe(b.personaId);
  if (personaAfter !== '') expect(a.personaId, 'смена собеседника не доехала до B').toBe(personaAfter);
  dlg = a;
});

test('10. старый клиент 0.9.29: дописывает, перегенерирует и удаляет рядом с веткой', async ({ browser }) => {
  await ensureSeed();
  const old = await device(await browser.newContext(), 0, OLD_029);
  await openDialogue(old.page, dlg.title, OLD_029);

  // (а) дописывание старым клиентом должно дойти до ветки.
  await sendTurn(old.page, 'Ход со старого клиента 0.9.29');
  await waitFlushed(old.page, user.uid, dlg.id);
  const seesOld = (x: Dlg[]) => countText(texts(x.find(d => d.id === dlg.id)), 'Ход со старого клиента 0.9.29') === 1;
  expect(seesOld(await syncUntil(A.page, seesOld, 'ветка видит ход 0.9.29')), 'ход старого клиента не дошёл до ветки').toBe(true);

  // (б) перегенерация — ДО удаления. В 0.9.29 replaceLastTurn позиционируется по
  // индексу (jw-029:src/features/ai/services/AIDialogueService.ts:114-126), и
  // предварительное удаление сдвинуло бы индекс: два разных дефекта смешались бы
  // в один неразбираемый список (так и вышло в первом прогоне M-6).
  await regenerate(old.page);
  await waitFlushed(old.page, user.uid, dlg.id);
  { const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const ka = JSON.stringify(texts((await dialogues(A.page, user.uid)).find(d => d.id === dlg.id)));
      const ko = JSON.stringify(texts((await dialogues(old.page, user.uid)).find(d => d.id === dlg.id)));
      if (ka === ko) break;
      await pass(A.page); await pass(old.page);
    } }
  const regenA = texts((await dialogues(A.page, user.uid)).find(d => d.id === dlg.id));
  const regenO = (await dialogues(old.page, user.uid)).find(d => d.id === dlg.id)!;
  console.warn('[10] после перегенерации 0.9.29: вариантов=', regenO.messages.at(-1)?.variants?.length, '| ветка:', JSON.stringify(regenA));
  expect(countText(regenA, 'Ход со старого клиента 0.9.29'), 'перегенерация на 0.9.29 задвоила ход на ветке').toBe(1);

  // (в) удаление на старом клиенте.
  const victim = (await dialogues(old.page, user.uid)).find(d => d.id === dlg.id)!.messages.filter(m => m.role === 'user').at(-2)?.content ?? '';
  expect(victim, 'на старом клиенте нечего удалять').not.toBe('');
  await deleteMessage(old.page, victim);
  const gone = await expect.poll(async () => !(await dialogues(old.page, user.uid)).find(d => d.id === dlg.id)?.messages.some(m => m.content === victim), { timeout: 20_000 }).toBe(true).then(() => true, () => false);
  const tomb = (await dialogues(old.page, user.uid)).find(x => x.id === dlg.id)?.deletedMessages;
  console.warn('[10] удаление записано на 0.9.29:', gone, '| victim:', victim.slice(0, 40), '| надгробия:', JSON.stringify(tomb));
  expect(gone, 'старый клиент не записал удаление — харнесс, не слияние').toBe(true);
  await waitFlushed(old.page, user.uid, dlg.id);

  await sendTurn(A.page, 'Ход ветки после хода старым клиента');
  for (let i = 0; i < 3; i++) { await pass(A.page); await pass(old.page); }
  const a = (await dialogues(A.page, user.uid)).find(d => d.id === dlg.id)!;
  const o = (await dialogues(old.page, user.uid)).find(d => d.id === dlg.id)!;
  console.warn('[10] ветка:', JSON.stringify(texts(a)), '| 0.9.29:', JSON.stringify(texts(o)));
  // Находка, а не регрессия ветки: в 0.9.29 deleteMessage вырезает реплику и НЕ
  // пишет надгробие (jw-029:src/features/ai/services/AIDialogueService.ts:148-160
  // @ 7d75999c). Копия ветки, которая удаления не видела, возвращает реплику.
  // Данные при этом не теряются — это и проверяем вместо невозможного для
  // старого клиента переживания удаления.
  expect(o.messages.some(m => m.content === victim), 'удаление старым клиентом не пережило слияние: ждём возврата реплики').toBe(true);
  expect(a.messages.some(m => m.content === victim), 'возврат реплики должен быть на обоих устройствах').toBe(true);
  expect(countText(texts(o), 'Ход ветки после хода старым клиента'), 'ход ветки не дошёл до 0.9.29').toBe(1);
  expect(countText(texts(a), 'Ход со старого клиента 0.9.29'), 'ход 0.9.29 задвоился на ветке').toBe(1);
  const idsA = a.messages.map(m => m.id).filter(x => x !== undefined);
  expect(new Set(idsA).size, 'на ветке появились дубли id после слияния со старым клиентом').toBe(idsA.length);
  const idsO = o.messages.map(m => m.id).filter(x => x !== undefined);
  expect(new Set(idsO).size, 'на 0.9.29 появились дубли id после слияния с веткой').toBe(idsO.length);
  await old.ctx.close();
});

test('11. диалог > 500 КБ на обоих устройствах, включая созданный на 0.9.28', async ({ browser }) => {
  test.setTimeout(540000);
  await ensureSeed();
  // Долгие операции стенда (несколько отправок с кулдауном, стрим 16 с,
  // постраничные выгрузки 600 КБ) не умещаются в общие 4 мин — таймаут по длительности.
  const old28 = await device(await browser.newContext(), 0, OLD_028);
  await old28.page.goto(OLD_028 + '/ai');
  await unlockVaultIfAsked(old28.page, user.password, 8_000);
  const big28: Dlg = {
    id: `big28_${Date.now().toString(36)}`, title: 'Большой с 0.9.28',
    messages: [{ role: 'user', content: 'Вопрос из 0.9.28' }, { role: 'assistant', content: 'Ю'.repeat(600_000) }],
    updatedAt: Date.now() - 60_000,
  };
  (big28 as unknown as { personaId: string; createdAt: number }).personaId = (dlg as unknown as { personaId: string }).personaId;
  (big28 as unknown as { createdAt: number }).createdAt = Date.now() - 120_000;
  await putDialogue(old28.page, user.uid, big28);
  await old28.page.reload();
  await openDialogue(old28.page, big28.title, OLD_028);
  await sendTurn(old28.page, 'Дописываем в большой с 0.9.28');
  // Ход обязан сесть именно в этот диалог: на старомorigin после перезагрузки
  // список мог ещё не отрисоваться, и раньше это выглядело как «облако пусто»,
  // потому что выгружать было нечего — очередь не получала сигнала.
  await waitTurnRecorded(old28.page, 'Дописываем в большой с 0.9.28');
  const routed = (await dialogues(old28.page, user.uid)).find(d => d.id === big28.id);
  expect(routed?.messages.some(m => m.content.includes('Дописываем в большой с 0.9.28')),
    'ход старого клиента сел не в большой диалог').toBe(true);
  await waitFlushed(old28.page, user.uid, big28.id);
  const paged28 = (await cloudRows(user.uid)).find(r => r.key === big28.id);
  console.warn('[11] 0.9.28 создал:', JSON.stringify(paged28));
  expect(paged28!.pages, 'диалог 0.9.28 не ушёл страницами').toBeGreaterThan(1);
  await cloudDetail(user.uid, big28.id, '11 страницы от 0.9.28');

  // Ветка забирает и дописывает — страницы прежней версии не должны сбить читателя.
  const sees = (x: Dlg[]) => (x.find(d => d.id === big28.id)?.messages.length ?? 0) >= 4;
  const a = await syncUntil(A.page, sees, 'ветка получает большой 0.9.28');
  expect(sees(a), 'ветка не собрала постраничный диалог 0.9.28').toBe(true);
  await openDialogue(A.page, big28.title);
  await sendTurn(A.page, 'Ход ветки в большом диалоге');
  await waitFlushed(A.page, user.uid, big28.id);
  await cloudDetail(user.uid, big28.id, '11 после выгрузки ветки');

  // Второе устройство ветки — тоже большой, и тоже дописывает.
  await syncUntil(B.page, sees, 'B получает большой');
  await openDialogue(B.page, big28.title);
  await sendTurn(B.page, 'Ход B в большом диалоге');
  await waitFlushed(B.page, user.uid, big28.id);
  for (let i = 0; i < 3; i++) { await pass(A.page); await pass(B.page); await pass(old28.page); }
  await cloudDetail(user.uid, big28.id, '11 итог');

  const da = (await dialogues(A.page, user.uid)).find(d => d.id === big28.id)!;
  const db = (await dialogues(B.page, user.uid)).find(d => d.id === big28.id)!;
  const d28 = (await dialogues(old28.page, user.uid)).find(d => d.id === big28.id)!;
  const full = (d: Dlg) => d.messages.filter(m => m.type !== 'system').map(m => `${m.role}:${m.content.length}`);
  console.warn('[11] длины A/B/0.9.28:', JSON.stringify(full(da)), JSON.stringify(full(db)), JSON.stringify(full(d28)));
  expect(full(da)).toEqual(full(db));
  expect(countText(texts(da), 'Ход ветки в большом диалоге')).toBe(1);
  expect(countText(texts(db), 'Ход B в большом диалоге')).toBe(1);
  expect(da.messages.some(m => m.content.length > 500_000), 'длинный ответ 0.9.28 потерялся при слиянии').toBe(true);
  // M-3: старый клиент не должен заводить фантомов из наших строк. Его парсер режет
  // ключ по последней «#», поэтому у сегмента адрес без «#» и без поля `data` —
  // 0.9.28 проходит мимо. Если это сломать, на старом устройстве появится лишняя
  // «запись» с адресом вида `id@seg…`.
  const phantom = (await dialogues(old28.page, user.uid)).filter(d => d.id.includes('@seg') || d.id.includes('#'));
  expect(phantom.map(d => d.id), `0.9.28 завёл фантомы: ${phantom.map(d => d.id).join(', ')}`).toEqual([]);
  await old28.ctx.close();
});

test('12b. часы B на сутки НАЗАД — ничего не теряется', async ({ browser }) => {
  await ensureSeed();
  // Долгие операции стенда (несколько отправок с кулдауном, стрим 16 с,
  // постраничные выгрузки 600 КБ) не умещаются в общие 4 мин — таймаут по длительности.
  const Bslow = await device(await browser.newContext(), -24 * 3600_000);
  await openDialogue(Bslow.page, dlg.title);
  await sendTurn(Bslow.page, 'Ход с часов, отставших на сутки');
  await waitFlushed(Bslow.page, user.uid, dlg.id);
  await openDialogue(A.page, dlg.title);
  await sendTurn(A.page, 'Ход A с точных часов');
  await waitFlushed(A.page, user.uid, dlg.id);
  for (let i = 0; i < 2; i++) { await pass(A.page); await pass(Bslow.page); }
  await cloudDetail(user.uid, dlg.id, '12b расхождение часов −1 сутки');
  const a = texts((await dialogues(A.page, user.uid)).find(d => d.id === dlg.id));
  const b = texts((await dialogues(Bslow.page, user.uid)).find(d => d.id === dlg.id));
  console.warn('[12b] A:', JSON.stringify(a));
  expect(countText(a, 'Ход с часов, отставших на сутки')).toBe(1);
  expect(countText(a, 'Ход A с точных часов')).toBe(1);
  expect(new Set(a).size).toBe(a.length);
  expect(a).toEqual(b);
  await Bslow.ctx.close();
});

test('13. аккаунт без сейфа: слияние работает, облачные строки открытые', async ({ browser }) => {
  await ensureSeed();
  // Долгие операции стенда (несколько отправок с кулдауном, стрим 16 с,
  // постраничные выгрузки 600 КБ) не умещаются в общие 4 мин — таймаут по длительности.
  // Новый аккаунт того же стенда: синхронизация включена, ключ сейфа не создан.
  const prev = user;
  user = await createUser('s38-novault');
  try {
    const N = await device(await browser.newContext(), 0, '', false);
    const M = await device(await browser.newContext(), 0, '', false);
    await grantAiConsent(N.page);
    await openChat(N.page);
    await sendTurn(N.page, 'Первый ход без сейфа');
    const nd = (await dialogues(N.page, user.uid))[0]!;
    await waitFlushed(N.page, user.uid, nd.id);
    await cloudDetail(user.uid, nd.id, '13 сырая строка аккаунта без сейфа', true);

    await openChat(M.page);
    await syncUntil(M.page, x => x.some(d => d.id === nd.id), 'M получает диалог');
    await openDialogue(M.page, nd.title);
    await sendTurn(M.page, 'Ход второго устройства без сейфа');
    await waitFlushed(M.page, user.uid, nd.id);
    await startTurn(N.page, 'Ход первого устройства без сейфа');
    await waitFlushed(N.page, user.uid, nd.id);
    for (let i = 0; i < 2; i++) { await pass(N.page); await pass(M.page); }
    await cloudDetail(user.uid, nd.id, '13 итог', true);

    const n = texts((await dialogues(N.page, user.uid)).find(d => d.id === nd.id));
    const m = texts((await dialogues(M.page, user.uid)).find(d => d.id === nd.id));
    console.warn('[13] N:', JSON.stringify(n), '| M:', JSON.stringify(m));
    expect(countText(n, 'Ход второго устройства без сейфа')).toBe(1);
    expect(countText(n, 'Ход первого устройства без сейфа')).toBe(1);
    expect(n).toEqual(m);
    await N.ctx.close(); await M.ctx.close();
  } finally {
    user = prev;
  }
});

test('15b. обрыв сети между сегментами и head’ом (указатель не подписан)', async () => {
  await ensureSeed();
  // Долгие операции стенда (несколько отправок с кулдауном, стрим 16 с,
  // постраничные выгрузки 600 КБ) не умещаются в общие 4 мин — таймаут по длительности.
  const huge: Dlg = {
    id: `brk_${Date.now().toString(36)}`, title: 'Обрыв между страницами',
    messages: [{ role: 'user', content: 'Вопрос перед обрывом' }, { role: 'assistant', content: 'Э'.repeat(600_000) }],
    updatedAt: Date.now() - 60_000,
  };
  (huge as unknown as { personaId: string; createdAt: number }).personaId = (dlg as unknown as { personaId: string }).personaId;
  (huge as unknown as { createdAt: number }).createdAt = Date.now() - 120_000;

  // Рвём ровно один запрос указателя версии: тело (страницы или сегменты) уже
  // легло, указателя нет — ровно то состояние, из которого M-1/M-5 обязаны
  // довыгрузить, а читатель — не выставить пустоту.
  let blocked = false;
  await A.ctx.route('**/rest/v1/local_store_records*', async (route) => {
    const body = route.request().postData() ?? '';
    if (!blocked && (body.includes('"manifest":true') || body.includes('"head":true'))) {
      blocked = true;
      console.warn('[15b] режу запрос указателя (тело уже в облаке)');
      return route.abort('failed');
    }
    return route.continue();
  });


  await putDialogue(A.page, user.uid, huge);
  await A.page.reload();
  await openDialogue(A.page, huge.title);

  await sendTurn(A.page, 'Ход после обрыва манифеста');
  // Выгрузка идёт асинхронно (дебаунс + постраничная запись), поэтому ждём именно
  // попытки записать манифест, а не проверяем флаг сразу после отправки.
  await expect.poll(() => blocked, { timeout: 90_000, intervals: [1000] }).toBe(true);
  await cloudDetail(user.uid, huge.id, '15b сразу после обрыва');

  const rows1 = await cloudRows(user.uid);
  const r1 = rows1.find(x => x.key === huge.id)!;
  console.warn('[15b] облако после обрыва:', JSON.stringify(r1));
  expect(r1.pages, 'дочерних строк не было — многострочный путь (страницы или сегменты) не сработал').toBeGreaterThan(1);

  // Следующая выгрузка (M-1/M-5): версия без указателя должна быть перечитана и
  // довыгружена, а не проигнорирована.
  //
  // M-5 меняет смысл самого обрыва: тело (сегменты) само по себе диалогом не
  // является, поэтому читатель обязан ОТКАЗАТЬСЯ, а не показать укороченную
  // копию. Проверяем обе половины: (1) до довыгрузки B не получает ничего,
  // (2) после — получает целый диалог.
  const sees = (x: Dlg[]) => (x.find(d => d.id === huge.id)?.messages.length ?? 0) >= 4;
  const before = await dialogues(B.page, user.uid);
  expect(sees(before), 'без head’а B показался целый диалог — значит указатель всё-таки записан').toBe(false);
  expect(before.some(d => d.id === huge.id), 'без head’а B собрал из осиротевших окон фасолдиалог').toBe(false);

  // Указатель дописывается следующим проходом выгрузки (триггер — смена
  // видимости вкладки, как в `pass`).
  let healed = false;
  for (let i = 0; i < 3 && !healed; i++) {
    await pass(A.page);
    healed = (await cloudRows(user.uid)).find(x => x.key === huge.id)?.pointer === true;
  }
  expect(healed, 'после обрыва head так и не был дописан').toBe(true);
  await waitFlushed(A.page, user.uid, huge.id);
  await cloudDetail(user.uid, huge.id, '15b после довыгрузки');

  const b = await syncUntil(B.page, sees, 'B получает диалог после обрыва');
  expect(sees(b), 'после обрыва указателя B не собрал диалог').toBe(true);
  const db = b.find(d => d.id === huge.id)!;
  expect(countText(texts(db), 'Ход после обрыва манифеста')).toBe(1);
  expect(db.messages.some(m => m.content.length > 500_000), 'длинный ответ потерялся').toBe(true);

  // Уборка: победитель CAS сносит всё, чего head не называет, и страницы прежней
  // копии. Без этого оборванная попытка оставляет в облаке мусор навечно.
  const state = await cloudSegmentState(user.uid, huge.id);
  expect(state.legacyKeys, `страницы прежней копии остались: ${state.legacyKeys.join(', ')}`).toEqual([]);
  expect(state.segKeys.filter(k => !state.named.includes(k)),
    `head не называет эти строки: ${state.segKeys.filter(k => !state.named.includes(k)).join(', ')}`).toEqual([]);
  dlg = (await dialogues(A.page, user.uid)).find(d => d.id === dlg.id) ?? dlg;
});

/** Снести облачную строку напрямую (сервисный ключ обходит RLS): так стенд
 *  моделирует потерю окна, которое head всё ещё называет. */
async function deleteCloudRow(uid: string, key: string): Promise<void> {
  const res = await fetch(`${REST}/local_store_records?user_id=eq.${uid}&store=eq.aiDialogues&key=eq.${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: { apikey: env.SERVICE_KEY!, Authorization: `Bearer ${env.SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`deleteCloudRow(${key}): ${res.status}`);
}

/** Диалог заведомо крупнее одной строки: 600-килобайтный ответ + несколько ходов. */
async function makeBigDialogue(page: Page, title: string, firstTurn: string): Promise<string> {
  const id = `big_${Math.random().toString(36).slice(2, 10)}`;
  const rec: Dlg = {
    id, title,
    messages: [{ role: 'user', content: 'Большой вопрос' }, { role: 'assistant', content: 'Ы'.repeat(600_000) }],
    updatedAt: Date.now() - 60_000,
  };
  (rec as unknown as { personaId: string; createdAt: number }).personaId = (dlg as unknown as { personaId: string }).personaId;
  (rec as unknown as { createdAt: number }).createdAt = Date.now() - 120_000;
  await putDialogue(page, user.uid, rec);
  await page.reload();
  await openDialogue(page, title);
  await sendTurn(page, firstTurn);
  await waitFlushed(page, user.uid, id);
  return id;
}

test('17. дописка в большой диалог не оставляет в облаке сирот', async () => {
  await ensureSeed();
  const id = await makeBigDialogue(A.page, 'Оконные сироты', 'Первый ход в большом');
  const before = await cloudSegmentState(user.uid, id);
  expect(before.pointer, 'head не подписан').toBe(true);
  expect(before.segKeys.length, 'окон нет').toBeGreaterThan(1);

  await sendTurn(A.page, 'Второй ход в большом');
  await waitFlushed(A.page, user.uid, id);

  const after = await cloudSegmentState(user.uid, id);
  const orphans = after.segKeys.filter(k => !after.named.includes(k));
  expect(orphans, `прежняя строка открытого окна осталась в облаке: ${orphans.join(', ')}`).toEqual([]);
  expect(after.named.length, 'head называет другое число окон').toBe(after.segKeys.length);
});

test('18. head называет окно, которого в облаке нет: читатель отказывает, а не укорачивает', async ({ browser }) => {
  await ensureSeed();
  const id = await makeBigDialogue(A.page, 'Отказ вместо обрезки', 'Ход перед потерей окна');
  const state = await cloudSegmentState(user.uid, id);
  expect(state.named.length).toBeGreaterThan(1);

  // Третье устройство забирает диалог целиком — до вреда.
  const C = await device(await browser.newContext());
  const seesAll = (x: Dlg[]) => (x.find(d => d.id === id)?.messages.length ?? 0) >= 4;
  const got = await syncUntil(C.page, seesAll, 'C получает целый диалог');
  expect(seesAll(got), 'C не получил целый диалог до порчи').toBe(true);

  // Рвём одну СТРОКУ, которую head продолжает называть.
  await deleteCloudRow(user.uid, state.named[1]!);

  // Новое устройство обязано ОТКАЗАТЬСЯ, а не показать укороченный дневник:
  // укороченная копия потом уехала бы в облако поверх целого. Ждём именно
  // попытки забора (иначе ассерт прошёл бы и когда забор просто не успел).
  const D = await device(await browser.newContext());
  const partialSeen = (x: Dlg[]) => x.some(d => d.id === id);
  const dList = await syncUntil(D.page, partialSeen, 'D получает диалог из неполного набора');
  expect(partialSeen(dList), 'D собрал диалог из неполного набора окон').toBe(false);

  // Хозяин копии довыгружает недостающее окно, и D получает целый диалог.
  await sendTurn(A.page, 'Ход после потери окна');
  await waitFlushed(A.page, user.uid, id);
  const healed = await syncUntil(D.page, seesAll, 'D получает диалог после починки');
  expect(seesAll(healed), 'после довыгрузки D так и не получил целый диалог').toBe(true);
  await C.ctx.close(); await D.ctx.close();
});

test('19. параллельный ход в большой диалог без забора: CAS head’а не даёт затереть соседа', async () => {
  await ensureSeed();
  const id = await makeBigDialogue(A.page, 'Гонка на head’е', 'Ход A до гонки');
  await syncUntil(B.page, x => x.some(d => d.id === id), 'B получает большой диалог');
  await openDialogue(B.page, 'Гонка на head’е');

  // Оба пишут, не забирая чужое: облако между чтением и записью меняется.
  await sendTurn(A.page, 'Ход A в гонке');
  await sendTurn(B.page, 'Ход B в гонке');
  await waitFlushed(A.page, user.uid, id);
  await waitFlushed(B.page, user.uid, id);
  for (let i = 0; i < 2; i++) { await pass(A.page); await pass(B.page); }

  const a = (await dialogues(A.page, user.uid)).find(d => d.id === id)!;
  const b = (await dialogues(B.page, user.uid)).find(d => d.id === id)!;
  expect(countText(texts(a), 'Ход A в гонке'), 'ход A затёрт').toBe(1);
  expect(countText(texts(a), 'Ход B в гонке'), 'ход B затёрт').toBe(1);
  expect(countText(texts(b), 'Ход A в гонке'), 'ход A не дошёл до B').toBe(1);
  expect(countText(texts(b), 'Ход B в гонке'), 'ход B не дошёл до B').toBe(1);
});

// Сценарии 12 и 15 стоят в конце серии намеренно: оба оставляют общий
// диалог-затравку в состоянии, из которого следующие тесты уже не работают.
// 15 удаляет затравку, а `ensureSeed` считает её готовой, пока переменная `dlg`
// не пуста — сценарий 4 после этого ждал диалог, которого больше нет (90 с в
// `syncUntil` + 20 с на локатор). 12 выкладывает в облако копию с отметкой на
// сутки вперёд, а скаляры в слиянии берутся LWW по updatedAt: у последующих
// тестов смена собеседника откатывалась к снимку из «будущего», и копии
// расходились (проверено тестом dialogueMergeFutureStamp.m6).
test('12. B’s clock +1 day — order and no loss', async ({ browser }) => {
  await ensureSeed();
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
  expect(countText(a, 'Ход с часов, ушедших на сутки вперёд')).toBe(1);
  expect(countText(a, 'Ход A с нормальных часов')).toBe(1);
  await Bfast.ctx.close();
});

test('15. delete the whole dialogue on A while B appends', async () => {
  await ensureSeed();
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
