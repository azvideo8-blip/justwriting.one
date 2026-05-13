import { readFileSync, readdirSync } from 'fs';
import { globSync } from 'glob';

const translationFiles = readdirSync('src/core/i18n/translations')
  .filter(f => f.endsWith('.ts'));

const definedKeys = new Set<string>();
const missingLocale: { key: string; missing: 'ru' | 'en' }[] = [];

for (const file of translationFiles) {
  const src = readFileSync(`src/core/i18n/translations/${file}`, 'utf-8');
  const keyMatches = [...src.matchAll(/^\s{2}(\w+):\s*\{((?:[^}'"]|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")*)\}/gm)];
  for (const match of keyMatches) {
    const key = match[1];
    const body = match[2];
    definedKeys.add(key);
    if (!body.includes("ru:")) missingLocale.push({ key, missing: 'ru' });
    if (!body.includes("en:")) missingLocale.push({ key, missing: 'en' });
  }
}

const srcFiles = globSync('src/**/*.{ts,tsx}', {
  ignore: ['src/core/i18n/**', 'src/**/__tests__/**', 'node_modules/**']
});

const usedKeys = new Set<string>();
for (const file of srcFiles) {
  const src = readFileSync(file, 'utf-8');
  const tMatches = [...src.matchAll(/\bt\(['"]([a-z][a-zA-Z_0-9]*)['"]/g)];
  for (const m of tMatches) usedKeys.add(m[1]);
  const arrayMatches = [...src.matchAll(/['"]([a-z][a-zA-Z_0-9]+)['"]/g)];
  for (const m of arrayMatches) {
    if (m[1].includes('_') && definedKeys.has(m[1])) usedKeys.add(m[1]);
  }
  const templateMatches = [...src.matchAll(/t\(`([a-z][a-zA-Z_]*)_\$\{/g)];
  for (const m of templateMatches) {
    const prefix = m[1] + '_';
    for (const k of definedKeys) {
      if (k.startsWith(prefix)) usedKeys.add(k);
    }
  }
}

const missing = [...usedKeys].filter(k => !definedKeys.has(k));
const unused = [...definedKeys].filter(k => !usedKeys.has(k));

console.log('\n=== MISSING KEYS (used in code, not in translations) ===');
missing.forEach(k => console.log(`  ❌ ${k}`));

console.log('\n=== UNUSED KEYS (in translations, not used in code) ===');
unused.forEach(k => console.log(`  🗑️  ${k}`));

console.log('\n=== MISSING LOCALE ===');
missingLocale.forEach(({ key, missing }) => console.log(`  ⚠️  ${key} — missing [${missing}]`));

console.log(`\nTotal defined: ${definedKeys.size}`);
console.log(`Total used: ${usedKeys.size}`);
console.log(`Missing: ${missing.length}, Unused: ${unused.length}, Incomplete: ${missingLocale.length}`);
