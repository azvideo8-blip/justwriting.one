import fs from 'fs';
import path from 'path';

/** Имя чанка без хэша содержимого: index-CSCSaN6_.js → index.js.
 *  Без этого изменившийся чанк получает новое имя, не находит себе пару в базе
 *  и уходит в «новый» — а к новым порог не применяется, поэтому оба гейта
 *  (index > 5%, vendor > 10%) не срабатывали никогда.
 *
 *  AUDIT-part3 bundle-size: хэш vite — ровно 8 символов последнего сегмента.
 *  Жадный {8,} с дефисом в классе съедал ИМЯ чанка тоже (vendor-sentry-Cdc_SYrQ
 *  → 'vendor.js'): все vendor-чанки схлопывались в одно имя и парились с чужой
 *  базой — отсюда фиктивные «+153%» и вечный красный Compare. */
export function stripHash(name: string): string {
  const ext = path.extname(name);
  return name.slice(0, -ext.length).replace(/-[A-Za-z0-9_-]{8}$/, '') + ext;
}

interface ChunkReport {
  name: string;
  size: number;
}

function getChunks(dir: string): ChunkReport[] {
  const files = fs.readdirSync(dir);
  return files
    .filter(f => f.endsWith('.js') || f.endsWith('.css'))
    .map(f => {
      const size = fs.statSync(path.join(dir, f)).size;
      return { name: f, size };
    });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function compareChunks(base: ChunkReport[], current: ChunkReport[]) {
  const changes: { name: string; diff: number; percent: string; baseSize: number; currentSize: number }[] = [];

  // AUDIT-part3 bundle-size: паринг multiset'ом. В одной сборке бывает два
  // чанка с одинаковым stripped-именем (index entry + legacy index) — наивный
  // find() сводил оба текущих к одному базовому, а второй базовый уходил в
  // «removed». Паринг по отсортированным размерам сводит большой с большим.
  const groupBy = (rows: ChunkReport[]) => {
    const g = new Map<string, number[]>();
    for (const r of rows) {
      const k = stripHash(r.name);
      const list = g.get(k) ?? [];
      list.push(r.size);
      g.set(k, list);
    }
    for (const list of g.values()) list.sort((a, b) => a - b);
    return g;
  };

  const baseGroups = groupBy(base);
  const currentGroups = groupBy(current);

  for (const [key, curSizes] of currentGroups) {
    const baseSizes = baseGroups.get(key);
    if (!baseSizes) {
      // New chunks (all sizes)
      for (const size of [...curSizes].sort((a, b) => a - b)) {
        changes.push({ name: key, diff: size, percent: 'new', baseSize: 0, currentSize: size });
      }
      continue;
    }
    const n = Math.min(curSizes.length, baseSizes.length);
    for (let i = 0; i < n; i++) {
      const curSize = curSizes[i]!;
      const baseSize = baseSizes[i]!;
      const diff = curSize - baseSize;
      const percent = baseSize === 0 ? '0.0' : ((diff / baseSize) * 100).toFixed(1);
      if (Math.abs(diff) > 512) {
        changes.push({
          name: key,
          diff,
          percent: `${diff > 0 ? '+' : ''}${percent}%`,
          baseSize,
          currentSize: curSize,
        });
      }
    }
    for (const size of curSizes.slice(n)) {
      changes.push({ name: key, diff: size, percent: 'new', baseSize: 0, currentSize: size });
    }
    for (const size of baseSizes.slice(n)) {
      changes.push({ name: key, diff: -size, percent: 'removed', baseSize: size, currentSize: 0 });
    }
  }

  for (const [key, baseSizes] of baseGroups) {
    if (!currentGroups.has(key)) {
      for (const size of baseSizes) {
        changes.push({ name: key, diff: -size, percent: 'removed', baseSize: size, currentSize: 0 });
      }
    }
  }

  return changes;
}

// CLI — guarded so importing stripHash for tests doesn't run the CLI.
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [,, baseDir, currentDir] = process.argv;

  if (!baseDir || !currentDir) {
    console.error('Usage: npx tsx scripts/bundle-compare.ts <base-dir> <current-dir>');
    process.exit(1);
  }

  if (!fs.existsSync(baseDir)) {
    console.error(`Base directory not found: ${baseDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(currentDir)) {
    console.error(`Current directory not found: ${currentDir}`);
    process.exit(1);
  }

  const base = getChunks(baseDir);
  const current = getChunks(currentDir);
  const changes = compareChunks(base, current);

  if (changes.length === 0) {
    console.log('No significant bundle size changes.');
    process.exit(0);
  }

  console.log('\n=== Bundle Size Changes ===\n');

  for (const { name, diff, percent, baseSize, currentSize } of changes) {
    const sign = diff > 0 ? '📈' : '📉';
    const diffStr = diff > 0 ? `+${formatBytes(diff)}` : formatBytes(Math.abs(diff));
    console.log(`${sign} ${name}`);
    console.log(`   ${formatBytes(baseSize)} → ${formatBytes(currentSize)} (${diffStr}, ${percent})`);
  }

  // Exit with error if the entry index chunk grew > 5%.
  // AUDIT-part3: имя теперь stripped ('index'); из двух одноимённых чанков
  // паринг даёт две записи — гейт смотрит на наибольший рост.
  const indexChanges = changes.filter(c => c.name === 'index');
  const worstIndex = indexChanges
    .filter(c => c.percent !== 'new' && c.percent !== 'removed')
    .sort((a, b) => parseFloat(b.percent) - parseFloat(a.percent))[0];
  if (worstIndex && parseFloat(worstIndex.percent) > 5) {
    console.error(`\n❌ index chunk grew > 5% (${formatBytes(worstIndex.baseSize)} → ${formatBytes(worstIndex.currentSize)}, ${worstIndex.percent})`);
    process.exit(1);
  }

  // Exit with error if any vendor chunk grew > 10%
  const vendorChange = changes
    .filter(c => c.name === 'vendor' || c.name.startsWith('vendor-'))
    .filter(c => c.percent !== 'new' && c.percent !== 'removed')
    .sort((a, b) => parseFloat(b.percent) - parseFloat(a.percent))[0];
  if (vendorChange && parseFloat(vendorChange.percent) > 10) {
    console.error(`\n❌ vendor chunk grew > 10% (${vendorChange.name}: ${formatBytes(vendorChange.baseSize)} → ${formatBytes(vendorChange.currentSize)}, ${vendorChange.percent})`);
    process.exit(1);
  }

  console.log('\n✅ Bundle size changes within acceptable limits.');
}
