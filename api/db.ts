// Единственный пул подключений на процесс (AUD-26). Два независимых пула —
// двойные соединения к Supavisor, два набора idle-timeout и две ручки тюнинга
// там, где нужна одна.
import { Pool } from 'pg';

// R4-082: пустой DATABASE_URL в проде — упасть на старте, а не держать сервис,
// отвечающий ошибкой на каждый вызов; /ready при этом честно отдаёт 503.
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  console.error('[db] DATABASE_URL is not set — refusing to start');
  process.exit(1);
}

// Потолок одного запроса. 15 с с запасом покрывают всё, что делает этот
// сервис: счётчики квот, согласия, телеметрия и каскадное удаление аккаунта
// (на проде на 2026-09-27 — 202 заметки, 226 версий, 193 эмбеддинга на аккаунт).
export const QUERY_TIMEOUT_MS = 15_000;

// `max` — явный, хотя и равен значению pg по умолчанию: при ≥10 одновременных
// запросов свободных соединений нет, и именно поэтому вложенная покупка
// соединения внутри открытой транзакции раньше вешала пул навсегда (N-77).
// `connectionTimeoutMillis` превращает такую покупку в ошибку через 5 с.
// Оба таймаута — клиентские: прод ходит через Supavisor, а он молча выбрасывает
// startup-параметры (`statement_timeout`, `idle_in_transaction_session_timeout`,
// `options` — проверено на проде 2026-09-27, в сессии остаются 0). Застрявшая
// транзакция всё равно отпускает соединение: запрос падает по `query_timeout`,
// а вызывающие делают ROLLBACK и release в finally.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
  query_timeout: QUERY_TIMEOUT_MS,
});

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});
