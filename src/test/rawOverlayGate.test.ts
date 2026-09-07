import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('AG-GATE-1 — Raw Overlay Gate (scripts/raw-overlay-check.sh)', () => {
  let tmpDir: string;
  const scriptPath = path.resolve(__dirname, '../../scripts/raw-overlay-check.sh');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-overlay-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('proves old gate (filename regex) missed arbitrary filenames with raw overlays (falsification)', () => {
    // Old gate logic from CI:
    // grep -rl "fixed inset-0" ... | grep -iE "(modal|sheet|prompt|overlay)"
    const arbitraryFile = 'src/features/writing/components/CustomEditorView.tsx';
    const oldRegex = /(modal|sheet|prompt|overlay)/i;
    expect(oldRegex.test(arbitraryFile)).toBe(false); // Old gate was blind to this file!
  });

  it('fails when an arbitrarily named file has a raw fixed inset-0 overlay', () => {
    const testFeatureDir = path.join(tmpDir, 'src/features/dummy');
    fs.mkdirSync(testFeatureDir, { recursive: true });
    const targetFile = path.join(testFeatureDir, 'ArbitraryNameComponent.tsx');

    fs.writeFileSync(targetFile, `
      export function ArbitraryNameComponent() {
        return <div className="fixed inset-0 bg-black/50">Raw overlay</div>;
      }
    `);

    let failed = false;
    try {
      execSync(`bash "${scriptPath}" "${tmpDir}"`, { stdio: 'pipe' });
    } catch (err: unknown) {
      failed = true;
      const errorOutput = String((err as { stdout?: Buffer; stderr?: Buffer }).stdout ?? '');
      expect(errorOutput).toContain('src/features/dummy/ArbitraryNameComponent.tsx');
    }
    expect(failed).toBe(true);
  });

  it('passes when deliberate fullscreen surface is marked with not-a-modal marker', () => {
    const testFeatureDir = path.join(tmpDir, 'src/features/dummy');
    fs.mkdirSync(testFeatureDir, { recursive: true });
    const targetFile = path.join(testFeatureDir, 'ArbitraryNameComponent.tsx');

    fs.writeFileSync(targetFile, `
      export function ArbitraryNameComponent() {
        {/* not-a-modal: fullscreen takeover */}
        return <div className="fixed inset-0 bg-black/50">Fullscreen takeover</div>;
      }
    `);

    const output = execSync(`bash "${scriptPath}" "${tmpDir}"`, { encoding: 'utf8' });
    expect(output).toContain('Raw overlay check: 0 unmanaged raw overlays found (OK)');
  });

  it('AUDIT-L6: fails when a file has one marked not-a-modal overlay but also an unmarked raw overlay', () => {
    const testFeatureDir = path.join(tmpDir, 'src/features/dummy');
    fs.mkdirSync(testFeatureDir, { recursive: true });
    const targetFile = path.join(testFeatureDir, 'MixedOverlaysComponent.tsx');

    fs.writeFileSync(targetFile, `
      export function MixedOverlaysComponent() {
        return (
          <>
            {/* not-a-modal: fullscreen takeover */}
            <div className="fixed inset-0 bg-black/50">Fullscreen takeover</div>

            {/* 15 lines away, an unmarked raw overlay */}
            <div>content</div>
            <div>content</div>
            <div>content</div>
            <div>content</div>
            <div>content</div>
            <div>content</div>
            <div>content</div>
            <div>content</div>
            <div>content</div>
            <div>content</div>
            <div>content</div>
            <div className="fixed inset-0 bg-black/80">Unmanaged raw modal</div>
          </>
        );
      }
    `);

    try {
      let failed = false;
      try {
        execSync(`bash "${scriptPath}" "${tmpDir}"`, { stdio: 'pipe' });
      } catch (err: unknown) {
        failed = true;
        const errorOutput = String((err as { stdout?: Buffer; stderr?: Buffer }).stdout ?? '');
        expect(errorOutput).toContain('MixedOverlaysComponent.tsx:');
      }
      expect(failed).toBe(true);
    } finally {
      fs.rmSync(targetFile, { force: true });
    }
  });

  it('passes when baseline explicitly records an unmigrated dialog', () => {
    const testFeatureDir = path.join(tmpDir, 'src/features/dummy');
    fs.mkdirSync(testFeatureDir, { recursive: true });
    const targetFile = path.join(testFeatureDir, 'LegacyModalToMigrate.tsx');
    const scriptsDir = path.join(tmpDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });

    fs.writeFileSync(targetFile, `
      export function LegacyModalToMigrate() {
        return <div className="fixed inset-0 bg-black/50">Legacy modal</div>;
      }
    `);

    fs.writeFileSync(path.join(scriptsDir, 'raw-overlay-baseline.txt'), `
      # Baseline
      src/features/dummy/LegacyModalToMigrate.tsx
    `);

    const output = execSync(`bash "${scriptPath}" "${tmpDir}"`, { encoding: 'utf8' });
    expect(output).toContain('Raw overlay check: 0 unmanaged raw overlays found (OK)');
  });

  it('passes cleanly on current codebase', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const output = execSync(`bash "${scriptPath}" "${repoRoot}"`, { encoding: 'utf8' });
    expect(output).toContain('Raw overlay check: 0 unmanaged raw overlays found (OK)');
  });
});
