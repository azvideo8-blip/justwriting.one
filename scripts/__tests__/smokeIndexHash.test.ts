// G-4 / F-002, F-055: проверка после выкатки смотрела на номер версии. При
// перевыкатке того же номера неудачное копирование index.html неотличимо от
// удачного — страница может быть предыдущая, а версия на ней «правильная».
// Теперь сравниваем sha256 отданного байтового тела с хэшем собранного файла.
//
// Фальсификация: в indexHashErrors заменить сравнение на `true` — краснеет тест
// «ловит расхождение»; в checkIndexHtmlHash убрать ветку «нет ожидалки» —
// краснеет тест пропуска; заменить `identity` на отсутствие заголовка — тест
// не заметит, поэтому проверяется только результат разбора тела.
import { describe, it, expect, vi } from 'vitest';
import {
  checkIndexHtmlHash,
  indexHashErrors,
  normalizeSha256,
  sha256Hex,
} from '../post-deploy-smoke';

const bytesOf = (text: string) => new TextEncoder().encode(text);
const stubResponse = (status: number, body: string) => ({
  status,
  arrayBuffer: async () => bytesOf(body).buffer as ArrayBuffer,
});

describe('AG-INDEX-HASH — сверка index.html после выкатки', () => {
  it('совпавшие байты не дают ошибок', () => {
    const body = '<!doctype html><title>justwriting</title>';
    const hex = sha256Hex(bytesOf(body));
    expect(indexHashErrors(hex, hex)).toEqual([]);
  });

  it('ловит расхождение и печатает оба хэша', () => {
    const errors = indexHashErrors(sha256Hex(bytesOf('<html>старый</html>')), sha256Hex(bytesOf('<html>новый</html>')));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('index.html на сервере != собранный');
    expect(errors[0]).toContain(sha256Hex(bytesOf('<html>новый</html>')));
    expect(errors[0]).toContain(sha256Hex(bytesOf('<html>старый</html>')));
  });

  it('хэш считается по байтам, а не по строке в другой кодировке', () => {
    expect(sha256Hex(bytesOf('абв'))).toBe(sha256Hex('абв'));
    expect(sha256Hex(bytesOf('абв'))).not.toBe(sha256Hex('abc'));
  });

  it('нормализует вывод sha256sum: суффикс, имя файла, регистр', () => {
    const hex = 'AB12CD';
    expect(normalizeSha256(`sha256:${hex}  dist/index.html`)).toBe('ab12cd');
    expect(normalizeSha256(`${hex}  dist/index.html`)).toBe('ab12cd');
    expect(normalizeSha256(`  ${hex}\n`)).toBe('ab12cd');
  });

  it('сверка проходит, когда сервер отдаёт собранные байты', async () => {
    const body = '<!doctype html><div id="root"></div>';
    const errors = await checkIndexHtmlHash({
      baseUrl: 'https://example.test/',
      expectedIndexSha256: sha256Hex(bytesOf(body)),
      fetchImpl: async () => stubResponse(200, body),
    });
    expect(errors).toEqual([]);
  });

  it('красно, когда сервер отдаёт другое содержимое той же версии', async () => {
    const errors = await checkIndexHtmlHash({
      baseUrl: 'https://example.test/',
      expectedIndexSha256: sha256Hex(bytesOf('<html>собранный</html>')),
      fetchImpl: async () => stubResponse(200, '<html>предыдущий</html>'),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('sha256 собранного');
  });

  it('без ожидалки — не «прошёл», а явно пропущено', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errors = await checkIndexHtmlHash({
      baseUrl: 'https://example.test/',
      expectedIndexSha256: undefined,
      fetchImpl: async () => {
        throw new Error('запроса быть не должно');
      },
    });
    expect(errors).toEqual([]);
    expect(log.mock.calls.map(c => String(c[0])).join('\n')).toMatch(/ПРОПУЩЕНА/);
    log.mockRestore();
  });

  it('сбой запроса — ошибка проверки, а не падение скрипта', async () => {
    const errors = await checkIndexHtmlHash({
      baseUrl: 'https://example.test/',
      expectedIndexSha256: 'aa',
      fetchImpl: async () => {
        throw new Error('ETIMEDOUT');
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ETIMEDOUT');
  });

  it('не 200 — ошибка со статусом', async () => {
    const errors = await checkIndexHtmlHash({
      baseUrl: 'https://example.test/',
      expectedIndexSha256: 'aa',
      fetchImpl: async () => stubResponse(500, ''),
    });
    expect(errors).toEqual(['index.html вернул HTTP 500 вместо 200']);
  });
});
