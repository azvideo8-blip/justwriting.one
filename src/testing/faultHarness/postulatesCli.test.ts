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
  }, 30_000);
});
