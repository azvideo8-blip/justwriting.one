// К21-3/К21-4: плашки под ответом ИИ. Ратчет — оба признака видны человеку на
// стенде, а не только в jsdom: строка «Модель видела N заметок» (материалы хода
// сохранены в реплике) и пометка «Здесь нет ссылок на записи — источник не
// указан» (пересказ выдачи без единой ссылки).
//
// Заглушка ИИ на стенде повторяет сообщение человека, поэтому вопрос подбирается
// так, чтобы в ответе оказалась нужная форма: для К21-4 — оборот пересказа
// «в записях» без `[#id]`. Тексты синтетические.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { grantAiConsent, shot, signInMobile, unlockVaultIfAsked, waitForNavigationSettled } from './harness';

const NOTE_TEXT = 'Утренняя смена началась в шесть: дорога пустая, кофе остыл до первого глотка.';
const NOTE_MARK = 'кофе остыл до первого глотка';

function psql(sql: string): void {
  const bin = process.env.STAND_PSQL_BIN;
  if (bin) {
    execFileSync(bin, ['-h', '127.0.0.1', '-p', process.env.STAND_PG_PORT ?? '5442', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
    return;
  }
  execFileSync('docker', ['exec', '-i', 'jw-stand-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
}

/**
 * Согласие на индексацию живёт в двух местах: localStorage устройства
 * (`indexingConsent.ts`) и колонках `public.users`, которые сверяет сервер
 * (`postgresAiContext.ts:164`). Одного localStorage мало: `/api/embedDocument`
 * отвечает 403, вектор запроса не строится, и ход уходит в «ничего не нашлось»
 * (проверено трейсом прогона 02.11.2026).
 */
function grantIndexingConsent(page: Page, uid: string) {
  if (!/^[0-9a-f-]{36}$/.test(uid)) throw new Error(`grantIndexingConsent: uid не uuid — ${uid.slice(0, 8)}…`);
  psql(`set session_replication_role = replica;
update public.users set indexing_consent_at = now(), indexing_consent_version = 2 where uid = '${uid}';
set session_replication_role = origin;`);
  return page.evaluate((id) => {
    localStorage.setItem(`ai_indexing_consent_v2_${id}`, 'granted');
  }, uid);
}

/** На телефоне «Сохранить» в панели `[data-write-toolbar]`, на широком экране — в шапке письма. */
function saveButton(page: Page) {
  return page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ })
    .or(page.getByRole('button', { name: /^Сохранить$/ }))
    .first();
}

/** «Сохранить» в панели письма только открывает лист завершения: в архив запись
 *  кладёт кнопка внутри листа (`finishSave(false)`), уход с открытым листом
 *  оставляет базу пустой — и поиск тогда честно пишет «0 заметок». */
async function openFinishSheet(page: Page, text: string) {
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill(text);
  await saveButton(page).click();
  const finish = page.locator('[aria-labelledby="finish-modal-title"]');
  await expect(finish, 'лист завершения не открылся').toBeVisible({ timeout: 20_000 });
  return finish;
}

async function saveNoteToArchive(page: Page, text: string) {
  const finish = await openFinishSheet(page, text);
  await finish.getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(finish, 'запись не сохранилась в архив').toBeHidden({ timeout: 30_000 });
  await waitForNavigationSettled(page);
}

/** Ход считается состоявшимся по ответу заглушки, а не по тексту в композере:
 *  строка вопроса совпадает с текстом поля ввода, и одна она ход не подтверждает. */
async function ask(page: Page, text: string) {
  const composer = page.locator('textarea').last();
  await composer.waitFor({ state: 'visible', timeout: 30_000 });
  await composer.fill(text);
  await page.getByRole('button', { name: /Отправить/ }).click();
  await expect(page.getByText(text).first(), 'ход не отправлен').toBeVisible({ timeout: 40_000 });
  await expect(page.getByText(/ответ заглушки на/).last(), 'ответ не пришёл').toBeVisible({ timeout: 120_000 });
}

test('К21-3: под ответом строка «Модель видела заметку» с переходом к ней', async ({ page }) => {
  const acc = await signInMobile(page, 'k21-plates-3');
  grantAiConsent(acc.uid);
  await page.reload();
  await unlockVaultIfAsked(page, acc.password);
  await grantIndexingConsent(page, acc.uid);

  const finish = await openFinishSheet(page, NOTE_TEXT);
  await finish.getByRole('button', { name: /Обсудить с ИИ/ }).click();
  await expect(finish).toBeHidden({ timeout: 20_000 });
  await waitForNavigationSettled(page);

  await ask(page, 'Что в этой записи главное?');

  const plate = page.getByTestId('ai-context-notes');
  await expect(plate, 'строки о заметках хода нет').toBeVisible({ timeout: 30_000 });
  await expect(plate).toContainText(/Модель видела/);
  await plate.scrollIntoViewIfNeeded();
  await shot(page, 'k21-3-context-notes');

  await plate.locator('summary').click();
  await expect(plate.getByRole('button').first(), 'список заметок не раскрылся').toBeVisible({ timeout: 15_000 });
  await shot(page, 'k21-3-context-notes-open');

  await plate.getByRole('button').first().click();
  // Читалка заметки своя на телефоне (`note-reader`) и своя на широком экране
  // (панель архива), поэтому проверяем не тестид, а текст заметки на экране.
  await expect(page.getByText(NOTE_MARK).first(), 'название не открыло заметку').toBeVisible({ timeout: 20_000 });
});

test('К21-4: пересказ выдачи без ссылок помечен под ответом', async ({ page }) => {
  const acc = await signInMobile(page, 'k21-plates-4');
  grantAiConsent(acc.uid);
  await page.reload();
  await unlockVaultIfAsked(page, acc.password);
  await grantIndexingConsent(page, acc.uid);

  // Для широкого хода запись нужна в архиве, не во вложении: сохраняем её
  // кнопкой листа завершения и только потом идём в диалог.
  await saveNoteToArchive(page, NOTE_TEXT);
  await page.goto('/ai');
  await waitForNavigationSettled(page);

  // Вопрос называет слова из записи дословно («кофе», «шесть»): ключевой поиск
  // на стенде — BM25 без русской морфологии, «утреннюю смену» против «Утренняя
  // смена» он не берёт, и выдача оказалась бы пустой (проверено прогоном
  // 02.11.2026: блок «не нашёл подходящих заметок», помечать нечего).
  await ask(page, 'Поищи в записях про кофе и шесть утра — что там было?');

  const plate = page.getByTestId('ai-no-note-refs');
  await expect(plate, 'пометки о пересказе без ссылок нет').toBeVisible({ timeout: 30_000 });
  await expect(plate).toContainText('нет ссылок на записи');
  await plate.scrollIntoViewIfNeeded();
  await shot(page, 'k21-4-no-note-refs');
});
