import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

describe('AG-BOUNDS-1 — Cross-feature boundary reduction', () => {
  it('passes cross-feature ratchet check at zero (0)', () => {
    const output = execSync('bash scripts/cross-feature-check.sh', { encoding: 'utf8' });
    expect(output).toContain('cross-feature imports: 0 (baseline: 0)');
  });

  it('ensures whole-screen composition MobileMePage and MobileMeScreen are located in src/app/pages', () => {
    expect(fs.existsSync(path.resolve('src/app/pages/MobileMePage.tsx'))).toBe(true);
    expect(fs.existsSync(path.resolve('src/app/pages/MobileMeScreen.tsx'))).toBe(true);
    expect(fs.existsSync(path.resolve('src/app/pages/MeAccountSection.tsx'))).toBe(true);

    // Old feature locations must not exist
    expect(fs.existsSync(path.resolve('src/features/writing/pages/MobileMePage.tsx'))).toBe(false);
    expect(fs.existsSync(path.resolve('src/features/writing/components/MobileMeScreen.tsx'))).toBe(false);
    expect(fs.existsSync(path.resolve('src/features/writing/components/MeAccountSection.tsx'))).toBe(false);
  });

  it('ensures AppRoutes lazy-loads MobileMePage from src/app/pages/MobileMePage', () => {
    const appRoutesContent = fs.readFileSync(path.resolve('src/app/AppRoutes.tsx'), 'utf8');
    expect(appRoutesContent).toContain("import('./pages/MobileMePage')");
  });
});
