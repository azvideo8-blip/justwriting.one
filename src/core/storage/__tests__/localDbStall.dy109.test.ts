// DY10-9 (инцидент 30.10): операция локальной базы, вставшая без ошибки, через
// 10 с оставляет предупреждение и поднимает событие для подсказки.
// Мутации: убрать reportError → (1) красный; убрать событие → (1) красный;
// не снимать таймер по завершении → (2) красный; убрать обёртку в saveNew → (3) красный;
// убрать обёртку локальной части saveVersion → (4) красный; обернуть весь
// saveVersion вместе с облаком (ревью 0.11.2) → (5) красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const reported: Array<{ message: string; ctx: unknown; level: unknown }> = [];
vi.mock('../../../shared/errors/reportError', () => ({
  reportError: (e: Error, ctx: unknown, level: unknown) => { reported.push({ message: e.message, ctx, level }); },
}));
const saveNew = vi.fn();
const saveVersionToLocal = vi.fn();
vi.mock('../../services/LocalStorageService', () => ({ LocalStorageService: {
  saveNew: (...a: unknown[]) => saveNew(...a),
  saveVersionToLocal: (...a: unknown[]) => saveVersionToLocal(...a),
} }));
vi.mock('../localDb', () => ({ getLocalDb: async () => ({}) }));
// Всё после локальной записи (профиль, облако) «висит» как медленная сеть.
vi.mock('../../services/ProfileUpdater', () => ({ ProfileUpdater: { updateLocalProfile: () => new Promise(() => {}) } }));

import { watchLocalDbStall, LOCAL_DB_STALLED_EVENT, LOCAL_DB_STALL_MS } from '../localDbStall';

describe('DY10-9: сторож локальной базы', () => {
  let events: string[];
  const onEvent = (e: Event) => { events.push((e as CustomEvent<{ op: string }>).detail.op); };
  beforeEach(() => {
    vi.useFakeTimers();
    reported.length = 0;
    events = [];
    window.addEventListener(LOCAL_DB_STALLED_EVENT, onEvent);
  });
  afterEach(() => {
    window.removeEventListener(LOCAL_DB_STALLED_EVENT, onEvent);
    vi.useRealTimers();
  });

  it('(1) операция не закончилась за 10 с — предупреждение с именем и событие', async () => {
    void watchLocalDbStall('saveVersion', new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(LOCAL_DB_STALL_MS + 1);
    expect(reported).toEqual([{ message: 'LOCAL_DB_STALLED: saveVersion', ctx: { action: 'localDbStalled', op: 'saveVersion' }, level: 'warning' }]);
    expect(events).toEqual(['saveVersion']);
  });

  it('(2) успела — тишина', async () => {
    await expect(watchLocalDbStall('x', Promise.resolve(7))).resolves.toBe(7);
    await vi.advanceTimersByTimeAsync(LOCAL_DB_STALL_MS * 2);
    expect(reported).toEqual([]);
    expect(events).toEqual([]);
  });

  it('(3) сохранение новой заметки под сторожем', async () => {
    saveNew.mockReturnValue(new Promise(() => {}));
    const { StorageService } = await import('../../services/StorageService');
    void StorageService.saveNew('u1', {} as never);
    await vi.advanceTimersByTimeAsync(LOCAL_DB_STALL_MS + 1);
    expect(events).toEqual(['saveNew']);
  });

  it('(4) локальная запись версии встала — сторож срабатывает', async () => {
    saveVersionToLocal.mockReturnValue(new Promise(() => {}));
    const { StorageService } = await import('../../services/StorageService');
    void StorageService.saveVersion('u1', 'd4', {} as never);
    await vi.advanceTimersByTimeAsync(LOCAL_DB_STALL_MS + 1);
    expect(events).toEqual(['saveVersion']);
  });

  it('(5) локально записано, а дальше медленно — это не «зависшая база»', async () => {
    saveVersionToLocal.mockResolvedValue({ ok: true, newVersion: 2, prevContent: '', existing: { guestId: 'u1' } });
    const { StorageService } = await import('../../services/StorageService');
    void StorageService.saveVersion('u1', 'd5', { content: 'x' } as never);
    await vi.advanceTimersByTimeAsync(LOCAL_DB_STALL_MS + 1);
    expect(events).toEqual([]);
  });
});
