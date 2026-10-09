// W-4: что разрешено напечатать про сбой поставщика в серверном журнале.
//
// Провайдеры в ответах 4xx эхом возвращают кусок отправленного запроса — то есть
// текст заметки, её заголовок, портрет, память и реплики диалога. `console.error(tag, e)`
// с объектом целиком уносит это в журнал, который читают люди и инструменты без
// доступа к сейфу пользователя. Здесь нет ни сообщения, ни тела: только статус,
// имя класса ошибки и код — и только если они выглядят как служебная метка.
const SAFE_TOKEN = /^[A-Za-z0-9_$.:-]{1,60}$/;

function slug(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return SAFE_TOKEN.test(trimmed) ? trimmed : undefined;
}

/**
 * Одна строка для журнала: `status=429 name=APICallError code=model_not_found`.
 * Пустая метка не подделывается содержимым ошибки — неподходящее значение
 * просто не печатается.
 */
export function safeErrorShape(e: unknown, status?: number | string): string {
  const err = e as { name?: unknown; code?: unknown } | null | undefined;
  const parts: string[] = [];
  const statusToken = slug(status);
  if (statusToken !== undefined) parts.push(`status=${statusToken}`);
  const name = slug(err?.name);
  if (name !== undefined) parts.push(`name=${name}`);
  const code = slug(err?.code);
  if (code !== undefined) parts.push(`code=${code}`);
  return parts.join(' ');
}
