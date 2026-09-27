// Единственный пул подключений на процесс (AUD-26). Два независимых пула —
// двойные соединения к Supavisor, два набора idle-timeout и две ручки тюнинга
// там, где нужна одна.
import { Pool } from 'pg';

// Потолок одной строки запроса. 15 с с запасом покрывают всё, что делает этот
// сервис: счётчики квот, согласия, телеметрия и каскадное удаление аккаунта
// (на проде на 2026-09-27 — 202 заметки, 226 версий, 193 эмбеддинга на аккаунт).
export const STATEMENT_TIMEOUT_MS = 15_000;

// Соединение, застрявшее внутри BEGIN, обязано само отпустить пул: без этого
// ошибка между BEGIN и COMMIT означала бы вечный висяк с занятым соединением.
export const IDLE_IN_TRANSACTION_TIMEOUT_MS = 10_000;

// `max` — явный, хотя и равен значению pg по умолчанию: при ≥10 одновременных
// запросов свободных соединений нет, и именно поэтому вложенная покупка
// соединения внутри открытой транзакции раньше вешала пул навсегда.
// `connectionTimeoutMillis` превращает такую вложенную покупку в ошибку через
// 5 с вместо вечного ожидания; `query_timeout` считается на клиенте и работает
// даже за пулером, `statement_timeout` ставится на соединении;
// `idle_in_transaction_session_timeout` добирает случай «внутри BEGIN и висит».
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
  query_timeout: STATEMENT_TIMEOUT_MS,
  statement_timeout: STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
});

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});
