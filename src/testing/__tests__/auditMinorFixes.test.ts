import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AU-6 audit minor issues regression tests', () => {
  it('package.json moves @types/pg to devDependencies and cleans dead overrides', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // @types/pg should NOT be in dependencies
    expect(pkg.dependencies['@types/pg']).toBeUndefined();
    // @types/pg MUST be in devDependencies
    expect(pkg.devDependencies['@types/pg']).toBeDefined();

    // Dead overrides must be removed
    const deadOverrides = ['path-to-regexp', 'uuid', 'hono', 'form-data'];
    for (const key of deadOverrides) {
      expect(pkg.overrides?.[key], `Override ${key} should be removed`).toBeUndefined();
    }
  });

  it('index.html specifies PNG for twitter:image and apple-touch-icon, and files exist', () => {
    const indexPath = path.resolve(process.cwd(), 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');

    // twitter:image must point to PNG
    expect(html).toMatch(/<meta\s+name="twitter:image"\s+content="https:\/\/justwriting\.ru\/og-image\.png"/);
    expect(html).not.toMatch(/<meta\s+name="twitter:image"\s+content="https:\/\/justwriting\.ru\/og-image\.svg"/);

    // apple-touch-icon must point to PNG
    expect(html).toMatch(/<link\s+rel="apple-touch-icon"\s+sizes="180x180"\s+href="\/apple-touch-icon\.png"/);
    expect(html).not.toMatch(/<link\s+rel="apple-touch-icon"\s+sizes="180x180"\s+href="\/apple-touch-icon\.svg"/);

    // apple-touch-icon.png must exist in public/
    const iconPath = path.resolve(process.cwd(), 'public/apple-touch-icon.png');
    expect(fs.existsSync(iconPath)).toBe(true);
    const stat = fs.statSync(iconPath);
    expect(stat.size).toBeGreaterThan(1000);
  });

  it('ci.yml specifies permissions and concurrency', () => {
    const ciPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
    const ciContent = fs.readFileSync(ciPath, 'utf8');

    expect(ciContent).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    // R7F-028: отмена в процессе — только у pull request. Push в main не
    // отменяется: второй пуш убивал прогон первого, и у коммита не оставалось
    // ни зелёного, ни красного вердикта — только `cancelled`.
    expect(ciContent).toMatch(/concurrency:\s*\n\s*group:\s*\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/);
    expect(ciContent).toMatch(/cancel-in-progress:\s*\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}/);
  });

  it('ArchiveNoteList.tsx does not use index key={i} in skeleton loader', () => {
    const listPath = path.resolve(process.cwd(), 'src/features/archive/components/ArchiveNoteList.tsx');
    const content = fs.readFileSync(listPath, 'utf8');

    expect(content).not.toMatch(/key=\{i\}/);
  });

});
