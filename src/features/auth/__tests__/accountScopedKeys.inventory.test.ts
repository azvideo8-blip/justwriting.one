import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  accountScopedLocalStorageKeys,
  clearAccountScopedStorage,
} from '../services/accountScopedKeys';

const SENTINEL = 'TEST_UID_SENTINEL';

function walkDir(dir: string): string[] {
  let results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
        results = results.concat(walkDir(fullPath));
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extracts per-account localStorage key templates from source files.
 */
function extractPerAccountLocalStorageTemplates(): Set<string> {
  const srcDir = path.resolve(__dirname, '../../../../src');
  const files = walkDir(srcDir);
  const templates = new Set<string>();

  for (const file of files) {
    // Skip accountScopedKeys.ts itself so we don't circularly match its own declared list
    if (file.endsWith('accountScopedKeys.ts')) continue;

    const content = fs.readFileSync(file, 'utf8');
    // Only consider files that interact with localStorage or define STORAGE_KEYS
    if (!content.includes('localStorage') && !file.endsWith('storageKeys.ts')) continue;

    // Map constant definitions in the same file: const KEY = 'value';
    const constMap = new Map<string, string>();
    for (const m of content.matchAll(/const\s+([A-Za-z0-9_]+)\s*=\s*['"]([^'"]+)['"]/g)) {
      if (m[1] && m[2]) {
        constMap.set(m[1], m[2]);
      }
    }

    // Match template literals: `...${...}...`
    for (const m of content.matchAll(/`([^`]+)`/g)) {
      let tpl = m[1];
      if (!tpl) continue;
      // Must contain an interpolation of uid / userId / ownerId / targetUid
      if (!/\$\{[^}]*(?:uid|userId|ownerId|targetUid)[^}]*\}/i.test(tpl)) continue;

      // Skip non-storage patterns (log errors, id generators, db names)
      if (
        tpl.startsWith('DUPLICATE_UUID') ||
        tpl.startsWith('justwriting-local-') ||
        tpl.startsWith('portrait_') ||
        tpl.startsWith('local_session_') ||
        tpl.startsWith('local_') ||
        tpl.startsWith('guest_') ||
        tpl.includes('already exists')
      ) {
        continue;
      }

      // Substitute local constants
      for (const [k, v] of constMap.entries()) {
        tpl = tpl.replaceAll(`\${${k}}`, v);
      }

      // Normalize interpolation to SENTINEL
      tpl = tpl.replace(/\$\{[^}]*(?:uid|userId|ownerId|targetUid)[^}]*\}/gi, SENTINEL);
      templates.add(tpl);
    }

    // R7F-021: ключ, собранный конкатенацией, — тот же пер-аккаунтный ключ, но
    // шаблонным литералом он не является. Прежним экстрактором он был невидим,
    // а из этого списка builtToAnotherAccount выводит «чужие» формы: незадекларированный
    // `'prefix_' + uid` не узнавался как чужой и стирался выходом другого
    // человека. Разрешаем оба порядка и только внутри обращения к хранилищу —
    // вне его конкатенации с uid бывают служебными (recordId в синхронизации).
    const CONCAT = /(?:localStorage|sessionStorage)\s*\.\s*(?:setItem|getItem|removeItem)\(\s*['"]([^'"]+)['"]\s*\+\s*(?:uid|userId|ownerId|targetUid)(?![\w])/gi;
    for (const m of content.matchAll(CONCAT)) {
      if (m[1]) templates.add(m[1] + SENTINEL);
    }
    const CONCAT_REV = /(?:localStorage|sessionStorage)\s*\.\s*(?:setItem|getItem|removeItem)\(\s*(?:uid|userId|ownerId|targetUid)\s*\+\s*['"]([^'"]+)['"]/gi;
    for (const m of content.matchAll(CONCAT_REV)) {
      if (m[1] !== undefined) templates.add(SENTINEL + m[1]);
    }
  }

  return templates;
}

describe('accountScopedKeys inventory test (LS-5 + LS-8)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('R7F-021: конкатенированный ключ хранилища попадает в инвентарь', () => {
    // Проба настоящим файлом в src: экстрактор ходит по дереву, поэтому
    // проверяем именно его, а не свою регулярку на строке-образце.
    const probePath = path.resolve(__dirname, '../../../../src/features/auth/services/__r7f021_probe.ts');
    fs.writeFileSync(probePath, [
      'export function touch(uid: string): void {',
      "  localStorage.setItem('r7f021_probe_' + uid, '1');",
      "  localStorage.removeItem(uid + '_r7f021_probe');",
      '}',
      '',
    ].join('\n'));
    try {
      const extracted = extractPerAccountLocalStorageTemplates();
      expect([...extracted].filter(t => t.includes('r7f021_probe')).sort(), 'обе формы конкатенации')
        .toEqual([SENTINEL + '_r7f021_probe', 'r7f021_probe_' + SENTINEL]);
    } finally {
      fs.rmSync(probePath);
    }
  });

  it('forward check: every per-account localStorage template is declared in accountScopedLocalStorageKeys', () => {
    const extracted = extractPerAccountLocalStorageTemplates();
    const declared = new Set(accountScopedLocalStorageKeys(SENTINEL));

    // Allowlist of known non-localStorage exceptions with written reasons:
    const ALLOWLIST: Record<string, string> = {
      // pending_keys_ is exclusively stored in sessionStorage (AuthService.ts)
      [`pending_keys_${SENTINEL}`]: 'sessionStorage only (AuthService.ts)',
      // draft-deleted- is exclusively stored in sessionStorage (WritingDraftService.ts)
      [`draft-deleted-${SENTINEL}`]: 'sessionStorage only (WritingDraftService.ts)',
      // vault_auto_unlock_failed_ is exclusively stored in sessionStorage (AuthService.ts)
      [`vault_auto_unlock_failed_${SENTINEL}`]: 'sessionStorage only (AuthService.ts)',
      // jw_pending_purge_ is a crash/wipe-failure recovery marker cleaned up by processPendingPurges at boot (S-9)
      [`jw_pending_purge_${SENTINEL}`]: 'crash/wipe-failure recovery marker cleaned by processPendingPurges at boot',
      // S1-5: курсор забора живёт в IndexedDB (запись profile), не в localStorage.
      [`sync_rev_cursor:${SENTINEL}`]: 'IndexedDB profile record key (S1-5), not localStorage',
      // R11-1: имя Web Lock забора по rev (navigator.locks), в хранилище не пишется.
      [`jw-sync-rev-pull:${SENTINEL}`]: 'navigator.locks name (R11-1), not storage',
    };

    const missing: string[] = [];
    for (const tpl of extracted) {
      if (ALLOWLIST[tpl]) continue;
      if (!declared.has(tpl)) {
        missing.push(tpl);
      }
    }

    expect(
      missing.sort(),
      `Found undeclared per-account localStorage templates: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('reverse check: every declared template in accountScopedLocalStorageKeys has a real localStorage writer', () => {
    const declared = accountScopedLocalStorageKeys(SENTINEL);
    const srcDir = path.resolve(__dirname, '../../../../src');
    const files = walkDir(srcDir);

    const storageKeysFile = fs.readFileSync(path.join(srcDir, 'shared/constants/storageKeys.ts'), 'utf8');
    const storageKeyProps = new Map<string, string>();
    for (const m of storageKeysFile.matchAll(/([A-Za-z0-9_]+)\s*:\s*\([^)]*\)\s*=>\s*[^`]*`([^`]+)`/g)) {
      if (m[1] && m[2]) {
        storageKeyProps.set(m[1], m[2]);
      }
    }

    const fileContents = files
      .filter((f) => !f.endsWith('accountScopedKeys.ts'))
      .map((f) => {
        let content = fs.readFileSync(f, 'utf8');
        for (const m of content.matchAll(/const\s+([A-Za-z0-9_]+)\s*=\s*['"]([^'"]+)['"]/g)) {
          if (m[1] && m[2]) {
            content = content.replaceAll('${' + m[1] + '}', m[2]);
          }
        }
        return { path: f, content };
      });

    const deadTemplates: string[] = [];
    // Писатель снят, а ключ остаётся в списке стирания: в браузерах людей лежат
    // старые значения, выход обязан их убрать.
    const RETIRED = new Set([
      'jw_pending_theme_touches_', // MB-7 (N-8): реестр тем удалён, очередь больше не пишется
    ]);

    for (const tpl of declared) {
      const at = tpl.indexOf(SENTINEL);
      const prefix = tpl.slice(0, at);
      if (RETIRED.has(prefix)) continue;
      const stem = prefix.replace(/[^a-zA-Z0-9_-]/g, '');

      let hasWriter = false;

      // 1. Direct: any file calling localStorage.setItem that contains prefix or stem
      for (const f of fileContents) {
        if (!f.content.includes('localStorage.setItem')) continue;
        if (f.content.includes(prefix) || f.content.includes(stem)) {
          hasWriter = true;
          break;
        }
      }

      // 2. Via STORAGE_KEYS: any file calling localStorage.setItem(STORAGE_KEYS.<PROP>
      if (!hasWriter) {
        for (const [prop, propTpl] of storageKeyProps.entries()) {
          if (propTpl.includes(stem)) {
            for (const f of fileContents) {
              if (f.content.includes('localStorage.setItem') && f.content.includes(`STORAGE_KEYS.${prop}`)) {
                hasWriter = true;
                break;
              }
            }
          }
          if (hasWriter) break;
        }
      }

      if (!hasWriter) {
        deadTemplates.push(tpl);
      }
    }

    expect(
      deadTemplates.sort(),
      `Found declared templates with no real writer: ${deadTemplates.join(', ')}`,
    ).toEqual([]);
  });

  it('isolation: ai_send_portrait_in_dialogue_${B} = 0 is preserved when A clears storage', () => {
    const userA = 'user-alice-123';
    const userB = 'user-bob-456';

    localStorage.setItem(`ai_send_portrait_in_dialogue_${userB}`, '0');
    localStorage.setItem(`ai_send_portrait_in_dialogue_${userA}`, '1');

    clearAccountScopedStorage(userA);

    expect(localStorage.getItem(`ai_send_portrait_in_dialogue_${userB}`)).toBe('0');
    expect(localStorage.getItem(`ai_send_portrait_in_dialogue_${userA}`)).toBeNull();
  });
});
