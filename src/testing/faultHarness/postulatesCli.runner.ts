import { describe, it } from 'vitest';
import { MatrixRunner } from './matrixRunner';
import * as fs from 'fs';
import * as path from 'path';

describe('Postulates CLI Runner', () => {
  it('runs full matrix and saves output', async () => {
    const runner = new MatrixRunner();
    const results = await runner.runFullMatrix();
    const outPath = process.env.POSTULATES_RESULTS_PATH || path.resolve('.postulates-results.json');
    fs.writeFileSync(outPath, JSON.stringify(results));
    // Спокойно — 2–3 с; под нагрузкой полного прогона обход занимал до 218 с
    // (аудит R3 §4.3). Потолок ниже внешнего spawnSync (300 с), чтобы падение
    // называло тайм-аут, а не молча убивалось снаружи.
  }, 280_000);
});
