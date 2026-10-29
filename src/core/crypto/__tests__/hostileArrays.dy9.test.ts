// Дейлик 29.10 Н-4(а) (DY9-4): N1-1 («сервер — враждебный канал») отказывал
// строке `_encrypted:false` с текстом, но в строке `_encrypted:true` поле-массив,
// пришедшее открытым массивом, проходило как своё: сервер мог дописать к
// настоящей заметке открытые теги. На проде таких строк 0 (счёт 29.10).
// Пустой [] — значение колонки по умолчанию, допустим.
// Мутация: убрать отказ для непустого массива → (1) красный.
import { describe, it, expect, beforeAll } from 'vitest';
import { generateDataKey, encryptContent, setSessionKey } from '../encrypt';
import { maybeDecrypt, setEncryptionEnabled } from '../cryptoHelpers';

let key: CryptoKey;
beforeAll(async () => {
  key = await generateDataKey();
  setEncryptionEnabled('u_dy9_arrays', true);
  setSessionKey(key);
});

describe('DY9-4: открытый массив в зашифрованной строке — не свой', () => {
  it('(1) теги открытым массивом рядом с шифротекстом — отказ', async () => {
    const row = { _encrypted: true, title: await encryptContent('заголовок', key), tags: ['MARKER_DY9_injected_tag'] };
    await expect(maybeDecrypt(row, ['title', 'mood'], ['tags'])).rejects.toThrow(/DECRYPTION_FAILED/);
  });

  it('(2) пустой [] (значение по умолчанию) — читается', async () => {
    const row = { _encrypted: true, title: await encryptContent('заголовок', key), tags: [] };
    await expect(maybeDecrypt(row, ['title', 'mood'], ['tags'])).resolves.toMatchObject({ title: 'заголовок', tags: [] });
  });

  it('(3) зашифрованный массив — расшифровывается как раньше', async () => {
    const row = { _encrypted: true, title: await encryptContent('заголовок', key), tags: await encryptContent(JSON.stringify(['свой']), key) };
    await expect(maybeDecrypt(row, ['title', 'mood'], ['tags'])).resolves.toMatchObject({ tags: ['свой'] });
  });
});
