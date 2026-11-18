/**
 * Объявление о выпуске в теме «Новости» группы в Telegram — последний шаг
 * выкатки. Текст — верхняя запись CHANGELOG (то же, что видно в приложении).
 * Сбой объявления выкатку не роняет: прод уже обновлён и проверен.
 */
import { setDefaultResultOrder } from 'node:dns';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CHANGELOG, type ChangelogRelease, type ChangelogCategory } from '../src/features/navigation/data/changelog';
import { APP_VERSION } from '../src/version';

const SECTIONS: [ChangelogCategory, string][] = [
  ['new', 'Новое'],
  ['improvement', 'Улучшено'],
  ['accessibility', 'Доступность'],
  ['fix', 'Исправлено'],
];
const TG_LIMIT = 4096;
const MINOR = 'Исправлены мелкие недоработки';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * null — объявлять нечего: выпуск только служебный. `earlier` — записи под
 * верхней: идущие подряд тихие (announce: false) выпуски попадают в это же
 * объявление одним списком — «что сделано с прошлого объявления».
 */
export function formatAnnouncement(release: ChangelogRelease, earlier: readonly ChangelogRelease[] = []): string | null {
  if (release.announce === false) return null;
  const quietCount = earlier.findIndex(r => r.announce !== false);
  const quiet = quietCount === -1 ? earlier : earlier.slice(0, quietCount);
  const since = quietCount > 0 ? earlier[quietCount]?.version : undefined;
  const seen = new Set<string>();
  const items = [release, ...quiet].flatMap(r => r.items)
    .filter(i => !i.ru.startsWith('Служебный выпуск'))
    // «Исправлены мелкие недоработки» из каждого тихого выпуска — один раз.
    .filter(i => !seen.has(i.ru) && Boolean(seen.add(i.ru)))
    .sort((a, b) => Number(a.ru.startsWith(MINOR)) - Number(b.ru.startsWith(MINOR)));
  if (items.length === 0) return null;
  // Не влезло в лимит Telegram — отбрасываем пункты с конца целиком: обрезка
  // по символам рвёт HTML-сущность или тег, и Telegram отвечает 400.
  for (let n = items.length; n > 0; n--) {
    const text = build(release.version, since, items.slice(0, n), items.length - n);
    if (text.length <= TG_LIMIT) return text;
  }
  return build(release.version, since, [], items.length);
}

function build(version: string, since: string | undefined, items: ChangelogRelease['items'], dropped: number): string {
  let text = `<b>Версия ${esc(version)} обновлена</b>`;
  if (since) text += `\nЧто сделано с версии ${esc(since)}:`;
  for (const [cat, title] of SECTIONS) {
    const lines = items.filter(i => i.category === cat).map(i => `• ${esc(i.ru)}`);
    if (lines.length) text += `\n\n<b>${title}</b>\n${lines.join('\n')}`;
  }
  if (dropped) text += `\n\n…и ещё ${dropped} — список изменений в приложении.`;
  return text;
}

/**
 * Сеть до Telegram с прода нестабильна: по IPv4 запрос таймаутит три раза из
 * четырёх, по IPv6 проходит (замер 10.10.2026, объявление 0.9.35 потерялось на
 * «fetch failed»). Сетевой сбой и 429/5xx повторяются; 4xx — нет: это ответ.
 */
export async function sendWithRetry(
  send: () => Promise<Response>,
  attempts = 4,
  delayMs = 5_000,
): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, delayMs));
    try {
      const res = await send();
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      lastError = new Error(`HTTP ${res.status}`);
      if (i === attempts - 1) return res;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  setDefaultResultOrder('ipv6first');
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId, TELEGRAM_THREAD_ID: threadId } = process.env;
  if (!token || !chatId) {
    console.log('Объявление пропущено: не заданы TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID.');
    return;
  }
  const release = CHANGELOG[0];
  if (release?.version !== APP_VERSION) {
    console.log(`::warning::Объявление пропущено: верхняя запись changelog ${release?.version} ≠ APP_VERSION ${APP_VERSION}.`);
    return;
  }
  // Повторная выкатка той же версии не дублирует объявление. Раннер живёт на
  // проде, домашний каталог переживает прогоны.
  const stateFile = process.env.ANNOUNCE_STATE_FILE ?? join(homedir(), '.jw-announced-version');
  let last = '';
  try { last = readFileSync(stateFile, 'utf8').trim(); } catch { /* файла ещё нет */ }
  if (last === release.version) {
    console.log(`Версия ${release.version} уже объявлена.`);
    return;
  }
  const text = formatAnnouncement(release, CHANGELOG.slice(1));
  if (!text) {
    console.log(`Версия ${release.version} служебная — не объявляем.`);
  } else {
    const res = await sendWithRetry(() => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        ...(threadId ? { message_thread_id: Number(threadId) } : {}),
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    }));
    if (!res.ok) {
      // Тело ответа Telegram не содержит токена; URL с токеном не печатаем.
      console.log(`::warning::Объявление не отправлено: Telegram ответил ${res.status} ${await res.text()}`);
      return;
    }
    console.log(`Версия ${release.version} объявлена.`);
  }
  writeFileSync(stateFile, release.version + '\n');
}

if (process.argv[1]?.endsWith('announce-release.ts')) {
  main().catch(e => console.log(`::warning::Объявление не отправлено: ${e instanceof Error ? e.message : String(e)}`));
}
