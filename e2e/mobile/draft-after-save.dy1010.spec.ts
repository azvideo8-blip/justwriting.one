// DY10-10: после сохранения заметки и быстрой перезагрузки в редактор
// возвращается уже сохранённый текст с плашкой «Черновик восстановлен».
//
// Спек — репродуктор гонки. Варианты отличаются тем, когда именно происходит
// перезагрузка относительно сохранения и чем замедлен прибор. Самописец
// (initScript) пишет каждую запись черновика — IndexedDB, унаследованный ключ
// localStorage, запросы в облако — вместе с событиями ухода со страницы: по
// порядку событий видно, какой из путей вернул текст. Журнал живёт в
// localStorage, поэтому переживает перезагрузку и содержит обе половины.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signInMobile, waitForMobileSettled, zenOff } from './harness';

const LOG_KEY = '__dy1010_log';
const LOG_DIR = process.env.DY1010_LOG_DIR ?? '/tmp/dy1010-logs';

/** Самописец: ставится до любого кода страницы и переживает перезагрузку. */
const RECORDER = `(() => {
  const KEY = ${JSON.stringify(LOG_KEY)};
  let log = [];
  try { log = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { log = []; }
  const push = (e) => {
    try {
      log.push({ t: Date.now(), ms: Math.round(performance.now()), ...e });
      localStorage.setItem(KEY, JSON.stringify(log.slice(-500)));
    } catch { /* самописец не должен ронять страницу */ }
  };
  window.__dy1010 = { push, log, clear: () => { log.length = 0; try { localStorage.removeItem(KEY); } catch {} } };

  const stack = () => String(new Error().stack || '').split('\\n').slice(1, 10).join(' | ').slice(0, 900);
  const brief = (v) => ({
    len: typeof v?.content === 'string' ? v.content.length : null,
    words: v?.wordCount ?? null,
    docId: v?.savedDocumentId === undefined ? 'undef' : v?.savedDocumentId === null ? 'null' : 'set',
    updatedAt: v?.updatedAt ?? null,
  });

  // Отсрочка локального автосохранения — 1000 мс на телефоне и 500 на десктопе
  // (useDraftAutosave.ts). Без этой метки «запись после удаления» неотличима от
  // записи до него: в журнале важен именно порядок относительно надгробия.
  const origSetTimeout = window.setTimeout;
  window.setTimeout = function (fn, delay) {
    const d = Number(delay);
    const watched = d === 1000 || d === 500 || d === 30000;
    if (watched) push({ ev: 'timer.set', delay: d });
    const wrapped = watched
      ? function () { push({ ev: 'timer.fire', delay: d }); return typeof fn === 'function' ? fn.apply(this, arguments) : undefined; }
      : fn;
    return origSetTimeout.apply(this, [wrapped, delay, ...Array.prototype.slice.call(arguments, 2)]);
  };

  for (const op of ['put', 'add', 'delete', 'clear']) {
    const orig = IDBObjectStore.prototype[op];
    if (typeof orig !== 'function') continue;
    IDBObjectStore.prototype[op] = function (...args) {
      try {
        if (this.name === 'drafts') {
          push({ ev: 'idb.' + op, ...(op === 'put' || op === 'add' ? brief(args[0]) : {}), stack: stack() });
        }
      } catch { /* hook */ }
      return orig.apply(this, args);
    };
  }

  const origSet = Storage.prototype.setItem;
  const origRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k, v) {
    try {
      if (this === window.localStorage && /^draft-/.test(String(k))) {
        push({ ev: 'ls.set', k: String(k), len: String(v).length, stack: stack() });
      } else if (this === window.localStorage && /DRAFT_DELETED|draft_del|jw_draft/i.test(String(k))) {
        push({ ev: 'ls.set', k: String(k), v: String(v).slice(0, 120) });
      }
    } catch { /* hook */ }
    return origSet.apply(this, arguments);
  };
  Storage.prototype.removeItem = function (k) {
    try {
      if (this === window.localStorage && /draft/i.test(String(k))) push({ ev: 'ls.remove', k: String(k) });
    } catch { /* hook */ }
    return origRemove.apply(this, arguments);
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    const method = String(init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
    const watch = /\\/rest\\/v1\\/(drafts|documents|versions|document_versions)/.test(url);
    if (watch) push({ ev: 'net', method, url: url.slice(0, 120) });
    const p = origFetch.apply(this, arguments);
    if (watch) p.then(r => push({ ev: 'net.done', method, status: r.status, url: url.slice(0, 120) }), () => push({ ev: 'net.fail', method, url: url.slice(0, 120) }));
    return p;
  };

  for (const ev of ['visibilitychange', 'pagehide', 'beforeunload', 'unload']) {
    window.addEventListener(ev, () => push({ ev: 'dom.' + ev, vis: document.visibilityState }), true);
  }
  push({ ev: 'boot' });
})()`;

type Row = Record<string, unknown>;

async function readLog(page: Page): Promise<Row[]> {
  return page.evaluate((key) => {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }, LOG_KEY).catch(() => [] as Row[]);
}

async function clearLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rec = (window as unknown as { __dy1010?: { clear: () => void } }).__dy1010;
    if (rec) rec.clear();
  }).catch(() => {});
}

/** Метка в журнале: по ней видно, что было до перезагрузки и что после. */
async function mark(page: Page, ev: string): Promise<number> {
  const t = Date.now();
  // Писать надо через самописец: прямой `localStorage.setItem` он затрёт
  // следующим же своим снимком журнала.
  await page.evaluate((name) => {
    const rec = (window as unknown as { __dy1010?: { push: (e: unknown) => void } }).__dy1010;
    if (rec) rec.push({ ev: name });
  }, ev).catch(() => {});
  return t;
}

/** Записать текст, открыть окно финиша и нажать в нём «Сохранить». */
async function saveNote(page: Page, text: string): Promise<void> {
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await mark(page, 'mark.fill');
  await editor.fill(text);
  await mark(page, 'mark.save_click');
  await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
  const dialog = page.getByRole('dialog').first();
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: /^Сохранить$/ }).click();
}

/**
 * Перезагрузка под замедлением прибора. Chromium в этом режиме иногда
 * обрывает собственную навигацию (`net::ERR_ABORTED`), хотя документ уже
 * заменён; ждать `load` здесь нельзя — проверка состояния важнее события.
 * Факт перезагрузки подтверждает `boot` в журнале самописца.
 */
async function reloadTolerant(page: Page): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.reload({ waitUntil: 'commit', timeout: 60_000 });
      return;
    } catch (e) {
      if (attempt >= 2) throw e;
      await page.waitForTimeout(1_000);
    }
  }
}

interface Evidence { value: string; banner: boolean; caught: boolean; log: Row[]; reloaded: boolean }

/** Снять состояние редактора и журнал; журнал — всегда файлом, даже до проверок. */
async function collect(page: Page, variant: string, reloadAt: number, extra: Record<string, unknown> = {}): Promise<Evidence> {
  const log = await readLog(page);
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  // Загрузка черновика асинхронна: даём ей состояться до проверки пустоты.
  await page.waitForTimeout(2_500);
  const value = await editor.inputValue().catch(() => '');
  const banner = await page.getByText('Черновик восстановлен').first().isVisible().catch(() => false);
  // Перезагрузка состоялась, если после неё в журнале есть `boot` новее метки.
  const reloaded = log.some(r => r.ev === 'boot' && Number(r.t) >= reloadAt);
  const evidence: Evidence = { value, banner, caught: banner || Boolean(value.trim()), log, reloaded };
  const name = `${variant}-${Date.now()}-${evidence.caught ? 'CAUGHT' : 'clean'}.json`;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(resolve(LOG_DIR, name), JSON.stringify({ variant, ...extra, ...evidence }, null, 1));
  } catch { /* журнал не обязан быть записан, чтобы проверка состоялась */ }
  await test.info().attach(`dy1010-log-${variant}.json`, {
    body: JSON.stringify({ variant, ...extra, ...evidence }, null, 1),
    contentType: 'application/json',
  });
  return evidence;
}

const TEXT = 'DY1010 основа. Раз два три четыре пять шесть семь.';

interface Variant {
  name: string;
  w: number;
  h: number;
  /** Замедление сети (CDP) на время сохранения. */
  net?: { latencyMs: number; throughputKb: number };
  /** Замедление CPU на время сохранения. */
  cpu?: number;
  /** Ждать пустого редактора перед перезагрузкой (как в упавшем тесте CI). */
  waitForEmpty: boolean;
  /** Пауза перед перезагрузкой, мс. */
  delayMs: number;
  /** Не перезагружать, а закрыть страницу и открыть новую. */
  reopen?: boolean;
}

const VARIANTS: Variant[] = [
  { name: 'after-empty', w: 390, h: 844, waitForEmpty: true, delayMs: 0 },
  // Основной вариант: медленная сеть на время сохранения растягивает окно между
  // стиранием черновика и сбросом сессии дольше секунды, и отсроченная запись
  // (1 с на телефоне) срабатывает внутри него. Без правки — 20 из 20.
  { name: 'slow-net', w: 390, h: 844, waitForEmpty: true, delayMs: 0, net: { latencyMs: 400, throughputKb: 60 } },
  { name: 'slow-net-1500', w: 390, h: 844, waitForEmpty: true, delayMs: 0, net: { latencyMs: 1500, throughputKb: 40 } },
  { name: 'slow-net-cpu', w: 390, h: 844, waitForEmpty: true, delayMs: 0, net: { latencyMs: 400, throughputKb: 60 }, cpu: 4 },
  { name: 'slow-cpu', w: 390, h: 844, waitForEmpty: true, delayMs: 0, cpu: 6 },
  { name: 'after-empty-2000', w: 390, h: 844, waitForEmpty: true, delayMs: 2_000 },
  { name: 'reopen-slow-net', w: 390, h: 844, waitForEmpty: true, delayMs: 0, net: { latencyMs: 400, throughputKb: 60 }, reopen: true },
  { name: 'slow-net-360', w: 360, h: 640, waitForEmpty: true, delayMs: 0, net: { latencyMs: 400, throughputKb: 60 } },
];

// В CI идут два варианта: `slow-net` — детектор (без правки красный 20 из 20),
// `after-empty` — форма упавшего теста CI (быстрая перезагрузка). Полная
// матрица замера — DY1010_VARIANTS=all, она дорогая и нужна для поиска условий.
const only = (process.env.DY1010_VARIANTS ?? 'slow-net,after-empty').split(',').map(s => s.trim()).filter(Boolean);
const selected = only.includes('all') ? VARIANTS : VARIANTS.filter(v => only.includes(v.name));

for (const v of selected) {
  test.describe(`DY10-10: ${v.name} ${v.w}×${v.h}`, () => {
    test.use({ viewport: { width: v.w, height: v.h } });

    test(`${v.name}: сохранил и перезагрузил — черновика нет`, async ({ page, context }) => {
      await zenOff(page);
      await page.addInitScript(RECORDER);
      const account = await signInMobile(page, `dy1010-${v.name}`.slice(0, 40));
      await waitForMobileSettled(page, account.password);
      await clearLog(page);

      // CDP есть только в Chromium: замедление сети и CPU — вариант для Mobile Chrome.
      const cdp = (v.net || v.cpu) ? await context.newCDPSession(page) : null;
      if (cdp && v.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: v.net.latencyMs, downloadThroughput: v.net.throughputKb * 1024, uploadThroughput: v.net.throughputKb * 1024 });
      if (cdp && v.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: v.cpu });

      let reloadAt = Date.now();
      let evidence: Evidence | null = null;
      try {
        await saveNote(page, TEXT);
        if (v.waitForEmpty) await expect(page.locator('textarea').first(), 'редактор не очистился после сохранения').toBeEmpty({ timeout: 90_000 });

        if (cdp && v.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        if (cdp && v.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        if (v.delayMs) await page.waitForTimeout(v.delayMs);

        reloadAt = await mark(page, 'mark.pre_reload');
        if (v.reopen) {
          await page.close();
          const page2 = await context.newPage();
          await page2.addInitScript(RECORDER);
          await page2.goto('/');
          await waitForMobileSettled(page2, account.password);
          evidence = await collect(page2, v.name, reloadAt, { reopen: true });
        } else {
          await reloadTolerant(page);
          await waitForMobileSettled(page, account.password);
          evidence = await collect(page, v.name, reloadAt);
        }
      } finally {
        // Падение до проверок не должно оставлять прогон без журнала: иначе
        // «поймали» неотличимо от «сломался харнесс».
        if (!evidence) {
          const log = await readLog(page);
          try {
            mkdirSync(LOG_DIR, { recursive: true });
            writeFileSync(
              resolve(LOG_DIR, `${v.name}-${Date.now()}-ABORT.json`),
              JSON.stringify({ variant: v.name, abortedBeforeAssert: true, reloadAt, log }, null, 1),
            );
          } catch { /* журнал не обязателен */ }
        }
        await cdp?.detach().catch(() => {});
      }

      expect(evidence, 'состояние после перезагрузки не снято').not.toBeNull();
      const e = evidence!;
      expect(e.reloaded, 'перезагрузка не состоялась — boot в журнале нет').toBe(true);
      expect(e.banner, `плашка «Черновик восстановлен»; в редакторе ${JSON.stringify(e.value.slice(0, 60))}`).toBe(false);
      expect(e.value.trim(), `редактор не пуст: ${JSON.stringify(e.value.slice(0, 60))}`).toBe('');
    });
  });
}
