// NB-16 (sus19): флаг «догрузить индекс» не записался (localStorage отказал),
// а requestEmbeddingRestore молчал — кнопка обещала догрузку, которой не будет.
// Запись возвращает boolean. Мутация: вернуть void/всегда true — красный а.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  requestEmbeddingRestore,
  isEmbeddingRestoreRequested,
} from '../embeddingRestoreState';

const UID = 'u_sus19_flag';
const origSetItem = Storage.prototype.setItem;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('NB-16: запись флага догрузки возвращает правду', () => {
  it('а) localStorage отказал на ключе флага — false, флаг не стоит', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (String(k).startsWith('ai_embed_restore_requested_')) throw new Error('SYNTHETIC_LS_QUOTA');
      return origSetItem.call(this, k, v);
    });
    expect(requestEmbeddingRestore(UID)).toBe(false);
    expect(isEmbeddingRestoreRequested(UID)).toBe(false);
  });

  it('контроль: хранилище доступно — true, флаг стоит', () => {
    expect(requestEmbeddingRestore(UID)).toBe(true);
    expect(isEmbeddingRestoreRequested(UID)).toBe(true);
  });

  it('пустой userId — false без записи', () => {
    expect(requestEmbeddingRestore('')).toBe(false);
  });
});