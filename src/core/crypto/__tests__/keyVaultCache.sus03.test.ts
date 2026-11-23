// NB-6 (sus03): saveDeviceKey глотал любой отказ — вызывающий не мог отличить
// «ключ лёг» от «IndexedDB недоступен». Теперь отказ — false.
// Мутация: вернуть catch {/* non-critical */} без return false — красный.
import { describe, it, expect, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { saveDeviceKey, loadDeviceKey, clearDeviceKey } from '../keyVaultCache';
import { generateDataKey } from '../encrypt';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NB-6: saveDeviceKey называет отказ', () => {
  it('контроль: ключ сохранён — true и читается обратно', async () => {
    const key = await generateDataKey();
    await expect(saveDeviceKey('u-sus03', key)).resolves.toBe(true);
    const loaded = await loadDeviceKey('u-sus03');
    expect(loaded).toBeInstanceOf(CryptoKey);
    await clearDeviceKey('u-sus03');
  });

  it('IndexedDB недоступен — false, а не молчаливый void', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('IDB blocked');
    });
    const key = await generateDataKey();
    await expect(saveDeviceKey('u-sus03', key)).resolves.toBe(false);
  });
});