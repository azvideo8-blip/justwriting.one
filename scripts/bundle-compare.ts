import fs from 'fs';
import path from 'path';

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

  for (const cur of current) {
    const baseChunk = base.find(b => b.name === cur.name);
    if (baseChunk) {
      const diff = cur.size - baseChunk.size;
      const percent = baseChunk.size === 0 ? '0.0' : ((diff / baseChunk.size) * 100).toFixed(1);
      if (Math.abs(diff) > 512) { // > 512 bytes
        changes.push({
          name: cur.name,
          diff,
          percent: `${diff > 0 ? '+' : ''}${percent}%`,
          baseSize: baseChunk.size,
          currentSize: cur.size,
        });
      }
    } else {
      // New chunk
      changes.push({
        name: cur.name,
        diff: cur.size,
        percent: 'new',
        baseSize: 0,
        currentSize: cur.size,
      });
    }
  }

  // Removed chunks
  for (const b of base) {
    if (!current.find(c => c.name === b.name)) {
      changes.push({
        name: b.name,
        diff: -b.size,
        percent: 'removed',
        baseSize: b.size,
        currentSize: 0,
      });
    }
  }

  return changes;
}

// CLI
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

// Exit with error if index chunk grew > 5%
const indexChange = changes.find(c => c.name.startsWith('index-'));
if (indexChange && indexChange.percent !== 'new' && indexChange.percent !== 'removed') {
  const percentValue = parseFloat(indexChange.percent);
  if (percentValue > 5) {
    console.error('\n❌ index chunk grew > 5%');
    process.exit(1);
  }
}

// Exit with error if vendor chunk grew > 10%
const vendorChange = changes.find(c => c.name.startsWith('vendor-'));
if (vendorChange && vendorChange.percent !== 'new' && vendorChange.percent !== 'removed') {
  const percentValue = parseFloat(vendorChange.percent);
  if (percentValue > 10) {
    console.error('\n❌ vendor chunk grew > 10%');
    process.exit(1);
  }
}

console.log('\n✅ Bundle size changes within acceptable limits.');
