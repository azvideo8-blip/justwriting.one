// Дейлик 04.11 Н-2: FD-2 поставил общий тормоз на шесть вызовов забора, а соседние
// чтения тех же проходов остались голыми — один 429 снимал весь проход. Список,
// который ведут руками, расходится: проверяем все чтения этих функций по исходнику.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const source = readFileSync('src/core/services/CloudSyncService.ts', 'utf8');
const READS = /\b(?:DataProvider\.getDocumentsByUuidsWithDeleted|readCloudDocumentsPartial|DocumentService\.getUserDocuments|pullChangesSince)\(/g;

describe('Н-2: чтения синка идут под общим тормозом 429', () => {
  it('каждый вызов — внутри withRateLimitRetry', () => {
    const bare: string[] = [];
    const calls = [...source.matchAll(READS)];
    for (const m of calls) {
      const lineStart = source.lastIndexOf('\n', m.index) + 1;
      const line = source.slice(lineStart, source.indexOf('\n', m.index));
      if (/^\s*(\/\/|\*)/.test(line) || /\bfunction\b|^import/.test(line)) continue;
      if (!line.includes('withRateLimitRetry(() =>')) bare.push(line.trim());
    }
    expect(bare).toEqual([]);
    expect(calls.length, 'проверка нашла вызовы').toBeGreaterThanOrEqual(6);
  });
});
