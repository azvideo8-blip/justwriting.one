// Единственный пул подключений на процесс (AUD-26). Два независимых пула —
// двойные соединения к Supavisor, два набора idle-timeout и две ручки тюнинга
// там, где нужна одна.
import { Pool } from 'pg';

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});
