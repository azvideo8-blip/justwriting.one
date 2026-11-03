import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// E-3: журнал входов GoTrue живёт не дольше 30 дней — через journald хоста,
// а не json-file с ротацией только по объёму.
// Мутация: убрать блок logging у auth или сменить драйвер → красный.
describe('GoTrue: журнал контейнера входа — в journald', () => {
  it('у auth logging.driver = journald', () => {
    const yml = readFileSync(join(process.cwd(), 'deploy', 'supabase-compose.override.yml'), 'utf8');
    // Блок сервиса auth: от «  auth:» до следующего сервиса на том же отступе.
    const auth = /^ {2}auth:\n([\s\S]*?)(?=^ {2}\S)/m.exec(yml)?.[1];
    expect(auth, 'сервиса auth в override нет').toBeDefined();
    expect(auth).toMatch(/^ {4}logging:\n {6}driver: journald$/m);
  });
});
