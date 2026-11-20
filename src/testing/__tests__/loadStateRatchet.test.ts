// load-state-fable: храповики «загрузка / ошибка / пусто» и «итог операции».
// Мутации (каждая прогнана на настоящем дереве и красит первый тест):
//  Р1 — вернуть в MobileMeScreen самодельную панель с t('retry');
//  Р2 — завести в новом файле `const [loading, setLoading] = useState(true)`;
//  Р3 — нарисовать <EmptyState> в ArchiveTrashView мимо LoadStateView;
//  Р4 — добавить в MobileNoteReader `showToast(t('ai_note_excluded'), 'success')`.
// Синтетические деревья ниже держат те же четыре правила красными навсегда.
// 19.11 вечером владелец включил блокировку всех четырёх (OBSERVE_ONLY пуст).
// Мутация Р5 — вернуть ключ в OBSERVE_ONLY: красный тест «все четыре блокируют».
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OBSERVE_ONLY, compareWithBaseline, countRawSuccessToasts, scanLoadState } from '../../../scripts/check-load-state.mjs';

const EMPTY_BASE: { retryPanels: string[]; ownLoadingState: string[]; emptyStateOutsideView: string[]; rawSuccessToasts: Record<string, number> } = { retryPanels: [], ownLoadingState: [], emptyStateOutsideView: [], rawSuccessToasts: {} };

function tree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'load-state-'));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const NONE = new Set<string>();
const blocking = (root: string, base = EMPTY_BASE) => compareWithBaseline(scanLoadState(root), base, NONE).blocking;

describe('load-state: храповик на настоящем дереве', () => {
  it('блокирующих находок нет; наблюдаемые напечатаны и не роняют', () => {
    const baseline = JSON.parse(readFileSync(join(process.cwd(), 'scripts/load-state-baseline.json'), 'utf8'));
    const { blocking: errors, observed } = compareWithBaseline(scanLoadState(process.cwd()), baseline);
    for (const line of observed) console.warn(`load-state (наблюдение, заблокировал бы): ${line}`);
    expect(errors).toEqual([]);
  });
});

describe('load-state: все четыре блокируют', () => {
  it('своё loading, сырой тост успеха, «Повторить» и EmptyState — в blocking', () => {
    expect([...OBSERVE_ONLY]).toEqual([]);
    const root = tree({
      'src/a/useThing.ts': 'const [loading, setLoading] = useState(true);',
      'src/a/Save.tsx': "showToast(t('saved'), 'success');",
      'src/a/Panel.tsx': "export const P = () => <button>{t('retry')}</button>;",
      'src/a/Bad.tsx': 'export const B = () => <EmptyState title="x" />;',
    });
    const result = compareWithBaseline(scanLoadState(root), EMPTY_BASE);
    expect(result.observed).toEqual([]);
    expect(result.blocking).toEqual(expect.arrayContaining([
      expect.stringContaining('src/a/useThing.ts: своё состояние loading'),
      expect.stringContaining('src/a/Save.tsx: тостов успеха 1, в базе 0'),
      expect.stringContaining('src/a/Panel.tsx: самодельное «Повторить»'),
      expect.stringContaining('src/a/Bad.tsx: EmptyState мимо LoadStateView'),
    ]));
    expect(result.blocking).toHaveLength(4);
  });
});

// Правила проверяются с пустым OBSERVE_ONLY: через неделю блокируют все четыре.
describe('load-state: каждое правило краснеет', () => {
  it('самодельное «Повторить»', () => {
    const root = tree({ 'src/a/Panel.tsx': "export const P = () => <button>{t('retry')}</button>;" });
    expect(blocking(root)).toEqual([expect.stringContaining('src/a/Panel.tsx: самодельное «Повторить»')]);
  });
  it('своё состояние loading', () => {
    const root = tree({ 'src/a/useThing.ts': 'const [loading, setLoading] = useState(true);' });
    expect(blocking(root)).toEqual([expect.stringContaining('src/a/useThing.ts: своё состояние loading')]);
  });
  it('EmptyState мимо LoadStateView; внутри LoadStateView — можно', () => {
    const root = tree({
      'src/a/Bad.tsx': 'export const B = () => <EmptyState title="x" />;',
      'src/a/Good.tsx': 'export const G = () => <LoadStateView empty={<EmptyState title="x" />} />;',
    });
    expect(blocking(root)).toEqual([expect.stringContaining('src/a/Bad.tsx: EmptyState мимо LoadStateView')]);
  });
  it('сырой тост успеха: явный и по умолчанию; ошибка и предупреждение — не в счёт', () => {
    expect(countRawSuccessToasts("showToast(t('done'), 'success');")).toBe(1);
    expect(countRawSuccessToasts("showToast(t('done'));")).toBe(1);
    expect(countRawSuccessToasts("showToast(\n  t('a', { n: f(1, 2) }),\n  'success',\n);")).toBe(1);
    expect(countRawSuccessToasts("showToast(t('bad'), 'error'); showToast(m, kind); showToast(t('w, x'), 'warning');")).toBe(0);
    const root = tree({ 'src/a/Save.tsx': "showToast(t('saved'), 'success');" });
    expect(blocking(root)).toEqual([expect.stringContaining('src/a/Save.tsx: тостов успеха 1, в базе 0')]);
  });
  it('база только убывает: исправленное место в базе — красный', () => {
    const root = tree({ 'src/a/Clean.tsx': 'export const C = () => null;' });
    const stale = { ...EMPTY_BASE, retryPanels: ['src/a/Clean.tsx'], rawSuccessToasts: { 'src/a/Clean.tsx': 2 } };
    expect(blocking(root, stale)).toEqual([
      expect.stringContaining('убери из retryPanels'),
      expect.stringContaining('уменьши rawSuccessToasts'),
    ]);
  });
  it('тесты и общие компоненты не сканируются', () => {
    const root = tree({
      'src/a/__tests__/x.test.tsx': "showToast(t('x')); t('retry'); const [loading, setLoading] = useState(true);",
      'src/shared/components/LoadStateView.tsx': "t('retry')",
    });
    expect(compareWithBaseline(scanLoadState(root), EMPTY_BASE, NONE)).toEqual({ blocking: [], observed: [] });
  });
});
