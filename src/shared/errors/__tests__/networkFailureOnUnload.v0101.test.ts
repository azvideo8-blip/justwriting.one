// Скрин владельца 2026-10-17 (iPhone): в журнале «Нет связи с сервером» ×3 и
// «TypeError: Load failed» — ровно в секунду, когда страница перезагрузилась
// (nginx: 499 по /api/embedDocument, тут же GET /). Запросы оборвал уход со
// страницы, а не сеть: синхронизация повторит их сама. Такие обрывы — не события
// для человека. Мутация: убрать проверку «страница уходит» → красный.
import { describe, it, expect, beforeEach } from 'vitest';
import { useActivityLogStore } from '../../activity/useActivityLogStore';
import { reportError, setupGlobalErrorListeners } from '../reportError';

describe('сетевые обрывы при уходе со страницы', () => {
  beforeEach(() => {
    useActivityLogStore.getState().clearLog();
    setupGlobalErrorListeners();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });

  it('после pagehide «Load failed» в журнал не попадает', () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    reportError(new TypeError('Load failed'), { action: 'embed' });
    expect(useActivityLogStore.getState().entries).toHaveLength(0);
  });

  it('другие ошибки при уходе со страницы по-прежнему пишутся', () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    reportError(new Error('real failure'), { action: 'x' });
    expect(useActivityLogStore.getState().entries).toHaveLength(1);
  });

  it('страница вернулась из кэша навигации — обрывы снова пишутся предупреждением', () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    reportError(new TypeError('Load failed'), { action: 'embed' });
    expect(useActivityLogStore.getState().entries).toHaveLength(1);
  });
});
