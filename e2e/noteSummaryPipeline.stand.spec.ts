import { test, expect, type Page, type Request } from '@playwright/test';
import { createUser } from './stand';
import { readFileSync } from 'node:fs';

// X-7: на стенде не было конвейера «заметка → разбор → вектор → контекст чата»,
// потому что заглушка ИИ не умела отвечать на промпт разбора заметки:
// summarizeDocument получал эхо-строку, не мог её разобрать и отдавал
// 503 «Failed to parse summary». Теперь заглушка отвечает схемой
// (scripts/stand/ai-stub-rules.mjs), и этот сценарий проверяет весь конвейер,
// включая то, ради чего он и затевался: светский ход обходится без архива (X-1),
// а вопрос про заметку получает её разбор.
//
// СТАТУС ПРОГОНА (стенд 3100/3104/3105, 06.10.2026): зелёный, три прогона
// подряд по 31–34 с. Конвейер виден целиком: заметка → `ai_summaries` (поле
// зашифровано) → `ai_embeddings` → ход «привет» без архивных блоков (живое
// подтверждение X-1) → вопрос про заметку с её разбором в теле запроса.
//
// Два шага этого сценария краснеют молча, поэтому они защищены проверками
// результата, а не факта клика:
// — согласие на индексацию: кнопка рендерится, пока согласия нет, и ждём именно
//   её исчезновения. Пропущенное согласие = нет вектора = вопрос про заметку
//   без контекста, что выглядит как дефект X-1/X-4;
// — второй ход: клиент режет отправку сам (`jw_ai_cooldown_until` +10 с и
//   `jw_ai_inflight`), в этом окне Enter даёт «Слишком частые запросы…» без
//   запроса. Ждём, пока оба гейта опустятся.
//
// Что нужно для запуска (кроме `bash scripts/stand/up.sh`):
//   STAND_AI_STUB_PORT=3105 node scripts/stand/ai-stub.mjs
//   PORT=3104 … AI_BASE_URL=http://127.0.0.1:3105/v1 \
//     AI_EMBED_BASE_URL=http://127.0.0.1:3105/v1 npx tsx api/server.ts
//   прокси стенда обязан знать API: up.sh запускается со STAND_API_PORT=3104
//   STAND_URL=http://localhost:3100 npx playwright test -c playwright.s38.config.ts \
//     e2e/noteSummaryPipeline.stand.spec.ts

test.describe.configure({ mode: 'serial' });
// Потолок, а не ожидание: сценарий ждёт три выгрузки в облако (заметка, разбор,
// вектор), и каждая идёт через фоновый проход синхронизации. Типовой прогон
// укладывается в минуты; 480 с — потолок на случай машины под нагрузкой, тогда
// падение видно по конкретному waitForRows, а не по общему таймауту теста.
test.setTimeout(480_000);

const env = Object.fromEntries(
  readFileSync('scripts/stand/.env.stand', 'utf8').split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const REST = `${env.STAND_URL}/rest/v1`;
const HEADERS = { apikey: env.SERVICE_KEY!, Authorization: `Bearer ${env.SERVICE_KEY}` };

/** Индексация для смыслового поиска — отдельное согласие в тех же настройках;
 *  без него заметка разбирается, но вектора не получает. */
async function enableSemanticSearch(page: Page, password: string): Promise<void> {
  await page.goto('/settings#security');
  await unlockVaultIfAsked(page, password);
  const btn = page.getByRole('button', { name: 'Включить поиск по смыслу' }).first();
  // Кнопка рендерится, только пока согласия на индексацию нет: исчезновение и
  // есть признание. Молча «не нашёл — значит включено» прячет дыру: без вектора
  // вопрос про заметку теряет контекст, и падение выглядит как дефект X-1/X-4.
  const alreadyGranted = !(await btn.isVisible({ timeout: 15_000 }).catch(() => false));
  if (!alreadyGranted) {
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout: 5_000 }).catch(async () => { await btn.dispatchEvent('click'); });
  }
  await expect(btn).toBeHidden({ timeout: 60_000 });
}

/** Разбор заметки — из предпросмотра в архиве: массовый разбор в профиле
 *  доступен только админу, и это осознанно (см. комментарий в ProfilePage). */
async function analyzeNotes(page: Page, password: string): Promise<void> {
  await page.goto('/archive');
  await unlockVaultIfAsked(page, password);
  const note = page.getByText('Сегодня бежал шесть километров').first();
  await expect(note).toBeVisible({ timeout: 60_000 });
  await note.click();
  // Кнопка разбора живёт в строке заметки и называется по состоянию:
  // «Не разобрано ИИ · Разобрать заметку через ИИ».
  const analyze = page.getByRole('button', { name: /Разобрать заметку через ИИ/ }).first();
  await expect(analyze).toBeVisible({ timeout: 30_000 });
  await analyze.click({ timeout: 5_000 }).catch(async () => { await analyze.dispatchEvent('click'); });
}

const NOTE_TEXT = 'Сегодня бежал шесть километров вдоль набережной. Ветер был резкий, '
  + 'но ноги шли легко, и я впервые за неделю лёг до полуночи. Хочется держать этот ритм.';

/** У `users` ключ называется `uid`, у остальных таблиц — `user_id`; неверный
 *  фильтр PostgREST отдаёт объектом-ошибкой, и проверка выглядит как «данных нет». */
async function tableRows(table: string, uid: string, select: string, by = 'user_id'): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${REST}/${table}?${by}=eq.${uid}&select=${select}`, { headers: HEADERS });
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`${table}: ответ не список — ${JSON.stringify(body).slice(0, 200)}`);
  return body as Array<Record<string, unknown>>;
}

/** Сейф спрашивают на каждом новом контексте: без разблокировки страница
 *  выглядит живой, но чтения из IndexedDB не отдают ничего. */
async function unlockVaultIfAsked(page: Page, password: string, wait = 1_500): Promise<void> {
  const btn = page.getByRole('button', { name: 'Разблокировать', exact: true });
  if (!(await btn.isVisible({ timeout: wait }).catch(() => false))) return;
  const dialog = page.getByRole('dialog').filter({ has: btn });
  const remember = dialog.getByRole('checkbox').first();
  if (await remember.isVisible().catch(() => false) && !(await remember.isChecked().catch(() => true))) {
    await remember.check().catch(() => {});
  }
  await dialog.locator('input[type="password"]').first().fill(password);
  await btn.click();
  await expect(btn).toBeHidden({ timeout: 30_000 });
}

/** Вход и разбор окон первого запуска: согласия, сейф, включение синхронизации. */
async function login(page: Page, u: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('input[type="email"]').fill(u.email);
  await page.locator('input[type="password"]').fill(u.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 90_000 });
  await unlockVaultIfAsked(page, u.password);

  const deadline = Date.now() + 60_000;
  let quiet = 0;
  while (Date.now() < deadline) {
    let acted = false;
    let open = false;
    for (const dialog of await page.getByRole('dialog').all()) {
      if (!(await dialog.isVisible().catch(() => false))) continue;
      open = true;
      for (const name of [/Я сохранил/, /Обязательно: Я прочитал/]) {
        const box = dialog.getByRole('checkbox', { name });
        if (await box.isVisible().catch(() => false) && !(await box.isChecked().catch(() => true))) {
          await box.check({ timeout: 2_000 }).catch(() => {});
        }
      }
      for (const label of ['Включить синхронизацию', 'Оставить выключенной', 'Продолжить']) {
        const btn = dialog.getByRole('button', { name: label });
        if (await btn.isVisible().catch(() => false) && await btn.isEnabled().catch(() => false)) {
          acted = (await btn.click({ timeout: 2_000 }).then(() => true, () => false)) || acted;
        }
      }
    }
    if (acted || open) { quiet = 0; await page.waitForTimeout(300); continue; }
    if (await page.locator('textarea').first().isVisible().catch(() => false) && ++quiet >= 3) break;
    await page.waitForTimeout(300);
  }
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 20_000 });
}

/** Истина согласия — столбец профиля, а не надпись в секции. */
async function grantAiConsent(page: Page, u: { uid: string; password: string }): Promise<void> {
  await page.goto('/settings#security');
  await unlockVaultIfAsked(page, u.password);
  const grant = page.getByRole('button', { name: 'Предоставить согласие' });
  await expect(grant.first()).toBeVisible({ timeout: 30_000 });
  // Порядок важен: force: true бьёт в точку даже поверх оверлея, и событие
  // достаётся не кнопке — так четыре прогона подряд ждали согласия, которого
  // никто не отправлял (в трассировке — ни одного PATCH с ai_consent_at).
  // Обычный клик проверяет переносимость удара; если мешает анимация или
  // перекрытие — событие уходит прямо на узел.
  await grant.first().scrollIntoViewIfNeeded().catch(() => {});
  await grant.first().click({ timeout: 5_000 }).catch(async () => {
    await grant.first().dispatchEvent('click');
  });
  await expect
    .poll(async () => {
      const granted = (await tableRows('users', u.uid, 'ai_consent_at', 'uid')).some(r => r.ai_consent_at !== null);
      if (!granted) await forcePass(page);
      return granted;
    }, { timeout: 180_000, intervals: [1_000] })
    .toBe(true);
}

/** Завершение сессии и сохранение заметки: Cmd/Ctrl+Enter → окно итогов → Save. */
async function finishAndSave(page: Page, uid: string): Promise<void> {
  const editor = page.locator('textarea').first();
  await editor.click();
  await editor.pressSequentially(NOTE_TEXT, { delay: 8 });
  await page.keyboard.press('ControlOrMeta+Enter');
  const dialog = page.locator('[role="dialog"]').last();
  const save = dialog.getByRole('button', { name: /^(Save|Сохранить)$/ }).first();
  await expect(save).toBeVisible({ timeout: 15_000 });
  await save.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  // Заметка в облаке — до разбора: без неё нечего анализировать.
  await waitForRows(page, 'documents', uid, 'id,title');
}

/** Фон-проход (забор + выгрузка) стартует по visibilitychange: без него запись
 *  лежит в очереди до ближайшего двухминутного тика, и ожидание «в облаке есть»
 *  превращается в гонку с таймером. */
async function forcePass(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(6_000);
}

async function waitForRows(page: Page, table: string, uid: string, select: string, by = 'user_id'): Promise<Array<Record<string, unknown>>> {
  let rows: Array<Record<string, unknown>> = [];
  await expect
    .poll(async () => {
      rows = await tableRows(table, uid, select, by);
      if (rows.length === 0) await forcePass(page);
      return rows.length;
    }, { timeout: 180_000, intervals: [1_000] })
    .toBeGreaterThan(0);
  return rows;
}

/** Отправляем ход и возвращаем тело запроса /api/chat, который он породил. */
async function sendAndCapture(page: Page, text: string): Promise<Record<string, unknown>> {
  const captured: Request[] = [];
  const listener = (req: Request) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/chat') captured.push(req);
  };
  // Отправку режет сам клиент: после хода ставятся `jw_ai_cooldown_until`
  // (+10 с) и `jw_ai_inflight`, и в этом окне Enter даёт «Слишком частые
  // запросы…» без запроса. Предыдущий ход ещё не остыл — ждём, а не шлём вникуда.
  await expect
    .poll(async () => {
      const now = Date.now();
      const gates = await page.evaluate(() => [
        Number(localStorage.getItem('jw_ai_cooldown_until') || '0'),
        Number(localStorage.getItem('jw_ai_inflight') || '0'),
      ]);
      return Math.max(0, ...gates.map((until) => until - now));
    }, { timeout: 60_000, intervals: [1_000] })
    .toBe(0);

  page.on('request', listener);
  const input = page.locator('textarea').first();
  await input.click();
  await input.pressSequentially(text, { delay: 8 });
  await input.press('Enter');
  // Enter отправляет не всегда: на втором ходе композер иногда ждёт нажатия
  // кнопки (после ответа показаны варианты, и отправка уходит не по клавише).
  // Если за 5 с запроса нет — бьём по «Отправить» и продолжаем ждать.
  if (captured.length === 0) {
    await page.waitForTimeout(5_000);
    if (captured.length === 0) {
      await page.getByRole('button', { name: 'Отправить' }).first().click({ timeout: 5_000 })
        .catch(async () => { await page.getByRole('button', { name: 'Отправить' }).first().dispatchEvent('click'); });
    }
  }
  await expect.poll(() => captured.length, { timeout: 90_000, intervals: [500] }).toBeGreaterThan(0);
  page.off('request', listener);
  return JSON.parse(captured[captured.length - 1]!.postData() ?? '{}') as Record<string, unknown>;
}

test('заметка → разбор → вектор → контекст: «привет» без архива, вопрос про заметку с разбором', async ({ page }) => {
  const u = await createUser('x7pipeline');

  await login(page, u);
  await grantAiConsent(page, u);
  await enableSemanticSearch(page, u.password);

  // 1. Заметка пишется, сессия завершается, черновик уходит в облако.
  await page.goto('/');
  await unlockVaultIfAsked(page, u.password);
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 20_000 });
  await finishAndSave(page, u.uid);

  // 2. Разбор запускается из архива и долетает до облака — это и есть то, что
  //    падало 503-м. Текст разбора в облаке зашифрован (данные живут на
  //    устройстве, в облако едет шифр), поэтому здесь проверяется сам факт
  //    строки, а читаемость разбора — там, где он уходит провайдеру открытым
  //    текстом.
  await analyzeNotes(page, u.password);
  const summaryRows = await waitForRows(page, 'ai_summaries', u.uid, 'document_id,summary');
  console.warn('[x7] строк разбора в облаке:', summaryRows.length,
    ', поле summary зашифровано (длина', String(summaryRows[0]?.summary ?? '').length, 'символов)');
  expect(String(summaryRows[0]?.document_id ?? '')).not.toBe('');

  // 3. Вектор заметки тоже в облаке — иначе вопросу про заметку нечего искать.
  await waitForRows(page, 'ai_embeddings', u.uid, 'document_id');

  // 4. Светский ход: архив в запрос не едет (X-1).
  await page.goto('/ai');
  await unlockVaultIfAsked(page, u.password);
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 20_000 });
  const helloContext = String((await sendAndCapture(page, 'привет')).documentContent ?? '');
  console.warn('[x7] «привет»: контекст', helloContext.length, 'знаков; архивных блоков:',
    'недавнего =', helloContext.includes('[Недавние записи]'),
    ', релевантных =', helloContext.includes('[Возможно релевантные заметки]'));
  expect(helloContext).not.toContain('[Недавние записи]');
  expect(helloContext).not.toContain('[Возможно релевантные заметки]');

  // 5. Вопрос про заметку: разбор этой заметки в запросе есть.
  const askedContext = String((await sendAndCapture(page, 'о чём была моя заметка про утреннюю пробежку?')).documentContent ?? '');
  console.warn('[x7] вопрос про заметку: контекст', askedContext.length, 'знаков; разбор в нём =',
    askedContext.includes('Автор записи'));
  expect(askedContext).toContain('Автор записи');
});
