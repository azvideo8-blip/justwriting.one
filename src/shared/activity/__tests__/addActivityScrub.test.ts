import { describe, it, expect, beforeEach } from 'vitest';
import { useActivityLogStore } from '../useActivityLogStore';

beforeEach(() => {
  localStorage.clear();
  useActivityLogStore.setState({ entries: [], panelOpen: false });
});

describe('addActivity PII-фильтр (AUD-7)', () => {
  it('прямой вызов addActivity вычёркивает title из контекста', () => {
    useActivityLogStore.getState().addActivity(
      'Заметка сохранена в облако',
      { action: 'addCloudCopy', documentId: 'local_x', title: 'Развод, день 4' },
      'success',
      'sync',
    );
    const entry = useActivityLogStore.getState().entries[0];
    expect(entry?.context).toBeDefined();
    expect(entry?.context?.title).toBeUndefined();
    expect(entry?.context?.documentId).toBeUndefined();
    // Не-PII ключи остаются
    expect(entry?.context?.action).toBe('addCloudCopy');
  });

  it('addError проходит тот же фильтр', () => {
    useActivityLogStore.getState().addError(
      new Error('boom'),
      { action: 'x', query: 'личный запрос' },
    );
    const entry = useActivityLogStore.getState().entries[0];
    expect(entry?.context?.query).toBeUndefined();
    expect(entry?.context?.action).toBe('x');
  });

  it('контекст из одних PII-ключей не создаёт пустой объект', () => {
    useActivityLogStore.getState().addActivity('msg', { title: 'секрет' });
    const entry = useActivityLogStore.getState().entries[0];
    expect(entry?.context).toBeUndefined();
  });
});
