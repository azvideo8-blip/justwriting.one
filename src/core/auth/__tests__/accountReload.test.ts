import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configure, renderHook, waitFor } from '@testing-library/react';
import {
  reloadForAccountChange,
  isAccountReloadPending,
  setAccountReloadTarget,
  _resetAccountReloadForTesting,
} from '../accountReload';
import * as reportErrorModule from '../../../shared/errors/reportError';
import { useWritingKeyboard } from '../../../features/writing/hooks/useWritingKeyboard';
import { useTimerStore } from '../../../features/writing/store/useTimerStore';
import { useSyncStatus } from '../../sync/useSyncStatus';
import { SyncService } from '../../services/SyncService';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import ts from 'typescript';

// Приёмка SYNC0 (L-1): drafts.ts тянет dateUtils → date-fns, и первый динамический
// импорт LocalStoreSyncService под vitest вырос со 135 до ~665 мс; 1 с по умолчанию
// под нагрузкой не хватало. Продукт не задет (dateUtils и так в стартовом куске).
configure({ asyncUtilTimeout: 5_000 });

vi.mock('../../services/SyncService', () => ({
  SyncService: {
    getPendingCount: vi.fn(),
    getUnsyncedCount: vi.fn(),
  },
}));

vi.mock('../../../shared/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

describe('R10-2: accountReload insurance and beforeunload veto prevention', () => {
  const origLocation = window.location;
  let reloadMock: ReturnType<typeof vi.fn>;
  let assignMock: ReturnType<typeof vi.fn>;
  let replaceMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetAccountReloadForTesting();
    reloadMock = vi.fn();
    assignMock = vi.fn();
    replaceMock = vi.fn();

    // Mock window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...origLocation,
        href: 'http://localhost:3000/notes',
        reload: reloadMock,
        assign: assignMock,
        replace: replaceMock,
      },
    });
  });

  afterEach(() => {
    _resetAccountReloadForTesting();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: origLocation,
    });
    vi.useRealTimers();
  });

  it('triggers insurance replace() after 3s if page remains alive', async () => {
    vi.useFakeTimers();
    const reportSpy = vi.spyOn(reportErrorModule, 'reportError');

    const promise = reloadForAccountChange();
    await promise;

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();

    // 2.9s: still waiting
    vi.advanceTimersByTime(2900);
    expect(replaceMock).not.toHaveBeenCalled();

    // 3.0s: fallback fires
    vi.advanceTimersByTime(100);
    expect(replaceMock).toHaveBeenCalledWith('http://localhost:3000/notes');
    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Account reload timed out') }),
      expect.objectContaining({ action: 'account_reload_timeout' }),
      'warning'
    );
  });

  it('retries navigation to specified target via replace() after 3s', async () => {
    vi.useFakeTimers();
    setAccountReloadTarget('/login');

    const promise = reloadForAccountChange();
    await promise;

    expect(assignMock).toHaveBeenCalledWith('/login');
    expect(replaceMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('useWritingKeyboard does NOT veto beforeunload when account reload is pending', async () => {
    useTimerStore.setState({ status: 'writing' });
    const dummyRef = { current: null };

    const { unmount } = renderHook(() =>
      useWritingKeyboard({
        sessionStatus: 'writing',
        handlePlayRef: dummyRef,
        handlePauseRef: dummyRef,
        handleFinishRef: dummyRef,
        toggleShortcutsRef: dummyRef,
      })
    );

    // 1. Without account reload pending: handler vetoes unload
    const event1 = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event1, 'returnValue', { writable: true, value: undefined });
    window.dispatchEvent(event1);
    expect(event1.defaultPrevented).toBe(true);
    expect(event1.returnValue).toBe('');

    // 2. With account reload pending: handler does NOT veto unload
    await reloadForAccountChange();
    expect(isAccountReloadPending()).toBe(true);

    const event2 = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event2, 'returnValue', { writable: true, value: undefined });
    window.dispatchEvent(event2);
    expect(event2.defaultPrevented).toBe(false);
    expect(event2.returnValue).toBeUndefined();

    unmount();
  });

  it('useSyncStatus does NOT veto beforeunload when account reload is pending', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('u1'), 'true');
    vi.mocked(SyncService.getPendingCount).mockResolvedValue(3);
    vi.mocked(SyncService.getUnsyncedCount).mockResolvedValue(0);

    const { result, unmount } = renderHook(() => useSyncStatus('u1'));

    await waitFor(() => {
      expect(result.current.pendingCount).toBe(3);
    });

    // 1. Without account reload pending: handler vetoes unload
    const event1 = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event1, 'returnValue', { writable: true, value: undefined });
    window.dispatchEvent(event1);
    expect(event1.defaultPrevented).toBe(true);
    expect(event1.returnValue).toBe('');

    // 2. With account reload pending: handler does NOT veto unload
    await reloadForAccountChange();
    expect(isAccountReloadPending()).toBe(true);

    const event2 = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event2, 'returnValue', { writable: true, value: undefined });
    window.dispatchEvent(event2);
    expect(event2.defaultPrevented).toBe(false);
    expect(event2.returnValue).toBeUndefined();

    unmount();
  });

  it('audits all beforeunload listeners in src/ to ensure they either do not veto or check isAccountReloadPending', async () => {
    // K-1/N-90: прежняя проверка была сабстрингом всего файла — файл с одним
    // гард-хендлером и одним вето-хендлером проходил. Теперь каждый
    // addEventListener('beforeunload', …) разбирается через TypeScript AST:
    // хендлер, который ветоирует (preventDefault / returnValue), сам обязан
    // вызывать isAccountReloadPending.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const glob = await import('glob');

    const srcDir = path.resolve(__dirname, '../../../');
    const files = glob.sync('**/*.{ts,tsx}', { cwd: srcDir, nodir: true, absolute: true })
      .map(f => f.split(path.sep).join('/'))
      .filter(f => !f.includes('/__tests__/') && !f.includes('/test/'));

    // Non-blind gate: must find at least 50 source files in src/
    expect(files.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    let listenerCount = 0;

    const isVetoCall = (node: ts.CallExpression): boolean =>
      ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'preventDefault';

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      if (!content.includes('beforeunload')) continue;

      const sf = ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );

      const namedHandlers = new Map<string, ts.Node>();
      const indexNames = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node) && node.name) {
          namedHandlers.set(node.name.text, node);
        } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
                   node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
          namedHandlers.set(node.name.text, node.initializer);
        }
        ts.forEachChild(node, indexNames);
      };
      indexNames(sf);

      const handlerOf = (arg: ts.Expression): ts.Node | undefined => {
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) return arg;
        if (ts.isIdentifier(arg)) return namedHandlers.get(arg.text);
        return undefined;
      };

      const vetoes = (node: ts.Node): boolean => {
        if (ts.isCallExpression(node) && isVetoCall(node)) return true;
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'returnValue') return true;
        return ts.forEachChild(node, vetoes) ?? false;
      };

      const guardsPending = (node: ts.Node): boolean => {
        if (ts.isIdentifier(node) && node.text === 'isAccountReloadPending') return true;
        return ts.forEachChild(node, guardsPending) ?? false;
      };

      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'addEventListener' &&
            node.arguments[0] && ts.isStringLiteral(node.arguments[0]) &&
            node.arguments[0].text === 'beforeunload' &&
            node.arguments[1]) {
          listenerCount++;
          const handler = handlerOf(node.arguments[1]) as ts.FunctionLikeDeclaration | undefined;
          if (handler && handler.body && vetoes(handler.body) && !guardsPending(handler.body)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            offenders.push(`${path.relative(srcDir, file).split(path.sep).join('/')}:${line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }

    // Non-blind gate: must have found all 4 known beforeunload registrations in src/
    expect(listenerCount).toBeGreaterThanOrEqual(4);

    expect(offenders).toEqual([]);
  });
});
