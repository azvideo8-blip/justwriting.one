// B-9 (ревью 0.10.1, журнал владельца 2026-10-18 10:53–10:54, iPhone 0.10.0):
// обрыв сети из Supabase попадал в журнал красной ошибкой. postgrest-js при сбое
// `fetch` не бросает `TypeError`, а возвращает обычный объект
// `{ message: 'TypeError: Load failed', code: '', … }` со `status: 0`
// (`node_modules/@supabase/postgrest-js/dist/index.mjs:416-456`), провайдер делает
// `throw error` (`src/core/data/providers/localStore.ts`), а `isNetworkFailure`
// требовал `instanceof TypeError` — и не распознавал.
import { describe, it, expect, beforeEach } from 'vitest';
import { useActivityLogStore } from '../../activity/useActivityLogStore';
import { reportError, setupGlobalErrorListeners, isNetworkFailure } from '../reportError';

/** Ровно та форма, что отдаёт postgrest-js: не `Error`, а plain-объект. */
const postgrestNetwork = (message: string) => ({ message, code: '', details: '', hint: '', status: 0 });

describe('B-9: сетевой сбой в форме postgrest', () => {
  beforeEach(() => {
    useActivityLogStore.getState().clearLog();
    setupGlobalErrorListeners();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });

  it('объект формы postgrest распознаётся как сетевой сбой', () => {
    expect(isNetworkFailure(postgrestNetwork('TypeError: Load failed'))).toBe(true);
    expect(isNetworkFailure(postgrestNetwork('FetchError: Failed to fetch'))).toBe(true);
    // Настоящая поломка под тем же «обёрнутым» префиксом не проходит.
    expect(isNetworkFailure(postgrestNetwork('TypeError: cannot read property id of undefined'))).toBe(false);
  });

  it('такой сбой идёт предупреждением, а не красной ошибкой', () => {
    reportError(postgrestNetwork('TypeError: Load failed'), { action: 'restoreAIData_local_store_records' });
    const entries = useActivityLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe('warning');
  });

  it('при уходе со страницы не пишется вовсе', () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    reportError(postgrestNetwork('TypeError: Load failed'), { action: 'restoreAIData_local_store_records' });
    expect(useActivityLogStore.getState().entries).toHaveLength(0);
  });

  it('AbortError из postgrest — отменённый запрос: при уходе молчим', () => {
    const aborted = { name: 'AbortError', message: 'AbortError: The user aborted a request.', code: '', status: 0 };
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    reportError(aborted, { action: 'backgroundSync_sweepOrphanedDocuments' });
    expect(useActivityLogStore.getState().entries).toHaveLength(0);

    // Без ухода со страницы отмена живёт по прежнему правилу: «ничейная»
    // промис-отмена (`unhandledrejection`) пишется спокойно, а сбой записи с
    // `action` остаётся error (ревью 0.10.1).
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    reportError({ message: 'AbortError: The user aborted a request.', code: '', status: 0 }, { source: 'unhandledrejection' });
    const last = useActivityLogStore.getState().entries[0];
    expect(last, 'отменённый запрос обязан писаться спокойно, а не красным').toBeTruthy();
    expect(last!.level).toBe('info');
  });

  it('обычная ошибка остаётся error', () => {
    reportError(new Error('real failure'), { action: 'x' });
    expect(useActivityLogStore.getState().entries[0]!.level).toBe('error');
  });
});
