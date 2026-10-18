// Журнал владельца 2026-10-17 22:06 (iPhone): «unhandledrejection AbortError» ×8
// и «Attempt to get records from database without an in-progress transaction»
// в backgroundSync_reattachAnalysis — за две секунды до перезагрузки страницы
// (nginx: GET /me в 17:06:05 UTC). Safari при выгрузке/заморозке страницы рвёт
// соединение с IndexedDB, операции в полёте падают; база переоткрывается сама
// (localDb слушает 'close'), фон повторит проход. Это не поломки.
// Мутации: убрать распознавание разрыва → красные кейсы 1 и 3.
import { describe, it, expect, beforeEach } from 'vitest';
import { useActivityLogStore } from '../../activity/useActivityLogStore';
import { reportError, setupGlobalErrorListeners } from '../reportError';

const abort = () => new DOMException('The operation was aborted.', 'AbortError');
const teardown = () => new Error('Attempt to get records from database without an in-progress transaction');

describe('разрыв соединения с базой и отменённые операции', () => {
  beforeEach(() => {
    useActivityLogStore.getState().clearLog();
    setupGlobalErrorListeners();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });

  it('после pagehide не пишутся вовсе', () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    reportError(abort(), { source: 'unhandledrejection' });
    reportError(teardown(), { action: 'backgroundSync_reattachAnalysis' });
    expect(useActivityLogStore.getState().entries).toHaveLength(0);
  });

  it('без ухода со страницы пишутся, но спокойно — info, а не error', () => {
    reportError(abort(), { source: 'unhandledrejection' });
    reportError(teardown(), { action: 'backgroundSync_reattachAnalysis' });
    const levels = useActivityLogStore.getState().entries.map(e => e.level);
    expect(levels).toHaveLength(2);
    expect(levels.every(l => l === 'info')).toBe(true);
  });

  it('обычная ошибка базы по-прежнему error', () => {
    reportError(new Error('QuotaExceededError: disk full'), { action: 'x' });
    expect(useActivityLogStore.getState().entries[0]?.level).toBe('error');
  });

  // Ревью 0.10.1: отменённая транзакция на пути сохранения — настоящий сбой записи.
  // Мутация: считать любой AbortError разрывом → красный.
  it('AbortError на сохранении (с action, без ухода) остаётся error', () => {
    reportError(abort(), { action: 'saveDraft' });
    expect(useActivityLogStore.getState().entries[0]?.level).toBe('error');
  });
});
