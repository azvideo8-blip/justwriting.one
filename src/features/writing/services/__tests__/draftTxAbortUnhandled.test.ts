// Журнал владельца 06.11, Safari: транзакция черновика оборвана, и рядом с записанной ошибкой
// приходит unhandledrejection (AbortError x2): `tx.done` отказывал без слушателя.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalDraft } from '../../../../core/storage/localDb';

const aborted = () => new DOMException('прервано', 'AbortError');
const brokenTx = () => {
  const done = new Promise<void>((_resolve, reject) => { setTimeout(() => reject(aborted()), 0); });
  return { done, store: { get: () => Promise.reject(aborted()), put: () => Promise.reject(aborted()) } };
};
vi.mock('../../../../core/storage/localDb', async (importActual) => ({
  ...(await importActual<typeof import('../../../../core/storage/localDb')>()),
  getLocalDb: vi.fn(async () => ({ objectStoreNames: { contains: () => true }, transaction: () => brokenTx() })),
}));
const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: reportErrorMock }));

import { WritingDraftService } from '../WritingDraftService';
import { applyWrite, type DraftRecord } from '../draftWriter';

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
const settle = () => new Promise(r => setTimeout(r, 20));

beforeEach(() => {
  unhandled.length = 0;
  reportErrorMock.mockClear();
  process.on('unhandledRejection', onUnhandled);
});
afterEach(() => { process.off('unhandledRejection', onUnhandled); });

describe('обрыв транзакции черновика', () => {
  it('rememberCloudSend: одно предупреждение и никакого unhandledrejection', async () => {
    await WritingDraftService.rememberCloudSend('u1', 'hash');
    await settle();
    expect(unhandled).toEqual([]);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock.mock.calls[0]?.[2]).toBe('warning');
  });

  it('applyWrite: отказ виден писателю, unhandledrejection нет', async () => {
    const rec = { userId: 'u2', owner: 'u2', content: 'текст', updatedAt: 1 } as unknown as LocalDraft;
    await expect(applyWrite(rec as unknown as DraftRecord, 'adopt-cloud', { uid: 'u2' })).rejects.toThrow();
    await settle();
    expect(unhandled).toEqual([]);
  });
});
