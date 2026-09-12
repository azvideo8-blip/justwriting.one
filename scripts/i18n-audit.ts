import { readFileSync, readdirSync } from 'fs';
import { globSync } from 'glob';
import { fileURLToPath } from 'url';

export function findHardcodedDialogs(src: string, file: string = ''): { file: string; match: string }[] {
  const hardcodedConfirmDialogs: { file: string; match: string }[] = [];
  const dialogPattern = /\b(confirmDialog|alertDialog|promptDialog)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = dialogPattern.exec(src)) !== null) {
    const fnName = match[1];
    const startIndex = match.index + match[0].length;
    let depth = 1;
    let i = startIndex;
    let inString: string | null = null;
    let isEscaped = false;

    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (inString) {
        if (isEscaped) {
          isEscaped = false;
        } else if (ch === '\\') {
          isEscaped = true;
        } else if (ch === inString) {
          inString = null;
        }
      } else {
        if (ch === "'" || ch === '"' || ch === '`') {
          inString = ch;
        } else if (ch === '(') {
          depth++;
        } else if (ch === ')') {
          depth--;
        }
      }
      i++;
    }

    const callContent = src.slice(startIndex, i - 1);
    if (/[\u0400-\u04FF]/.test(callContent)) {
      hardcodedConfirmDialogs.push({
        file,
        match: `${fnName}(${callContent.replace(/\s+/g, ' ').trim().slice(0, 100)})`,
      });
    }
  }

  return hardcodedConfirmDialogs;
}

export function runAudit() {
  const translationFiles = readdirSync('src/shared/i18n/translations')
    .filter(f => f.endsWith('.ts'));

  const definedKeys = new Set<string>();
  const missingLocale: { key: string; missing: 'ru' | 'en' }[] = [];

  for (const file of translationFiles) {
    const src = readFileSync(`src/shared/i18n/translations/${file}`, 'utf-8');
    const keyMatches = [...src.matchAll(/^\s{2}(\w+):\s*\{((?:[^}'"]|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")*)\}/gm)];
    for (const match of keyMatches) {
      const key = match[1];
      const body = match[2];
      if (!key || !body) continue;
      definedKeys.add(key);
      if (!body.includes("ru:")) missingLocale.push({ key, missing: 'ru' });
      if (!body.includes("en:")) missingLocale.push({ key, missing: 'en' });
    }
  }

  const srcFiles = globSync('src/**/*.{ts,tsx}', {
    ignore: ['src/shared/i18n/**', 'src/**/__tests__/**', 'node_modules/**']
  });

  const usedKeys = new Set<string>();
  for (const file of srcFiles) {
    const src = readFileSync(file, 'utf-8');
    const tMatches = [...src.matchAll(/\bt\(['"]([a-z][a-zA-Z_0-9]*)['"]/g)];
    for (const m of tMatches) {
      const key = m[1];
      if (key) usedKeys.add(key);
    }
    const arrayMatches = [...src.matchAll(/['"]([a-z][a-zA-Z_0-9]+)['"]/g)];
    for (const m of arrayMatches) {
      const key = m[1];
      if (key && key.includes('_') && definedKeys.has(key)) usedKeys.add(key);
    }
    const templateMatches = [...src.matchAll(/t\(`([a-z][a-zA-Z_]*)_\$\{/g)];
    for (const m of templateMatches) {
      const key = m[1];
      if (!key) continue;
      const prefix = key + '_';
      for (const k of definedKeys) {
        if (k.startsWith(prefix)) usedKeys.add(k);
      }
    }
  }

  const hardcodedConfirmDialogs: { file: string; match: string }[] = [];
  for (const file of srcFiles) {
    const src = readFileSync(file, 'utf-8');
    hardcodedConfirmDialogs.push(...findHardcodedDialogs(src, file));
  }

  const missing = [...usedKeys].filter(k => !definedKeys.has(k));
  const unused = [...definedKeys].filter(k => !usedKeys.has(k));

  console.log('\n=== MISSING KEYS (used in code, not in translations) ===');
  missing.forEach(k => console.log(`  ❌ ${k}`));

  console.log('\n=== UNUSED KEYS (in translations, not used in code) ===');
  unused.forEach(k => console.log(`  🗑️  ${k}`));

  console.log('\n=== MISSING LOCALE ===');
  missingLocale.forEach(({ key, missing }) => console.log(`  ⚠️  ${key} — missing [${missing}]`));

  if (hardcodedConfirmDialogs.length > 0) {
    console.log('\n=== HARDCODED CYRILLIC IN CONFIRM DIALOGS ===');
    hardcodedConfirmDialogs.forEach(({ file, match }) => console.log(`  ❌ ${file}: ${match}`));
  }

  console.log(`\nTotal defined: ${definedKeys.size}`);
  console.log(`Total used: ${usedKeys.size}`);
  console.log(`Missing: ${missing.length}, Unused: ${unused.length}, Incomplete: ${missingLocale.length}, Hardcoded Dialogs: ${hardcodedConfirmDialogs.length}`);

  if (missing.length > 0 || missingLocale.length > 0 || hardcodedConfirmDialogs.length > 0) {
    process.exit(1);
  }
}

if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('i18n-audit.ts'))) {
  runAudit();
}


