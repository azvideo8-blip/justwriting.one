import { describe, it, expect } from 'vitest';
import * as fields from '../core/data/providers/fields';

/**
 * S1-4, гейт: `rev` — серверная колонка, и клиент не имеет права её писать.
 * `toDb` (fields.ts) пропускает только поля из карт `*_FIELDS`; если `rev`
 * появится в любой карте, клиент начнёт присылать номер и упрётся в триггер,
 * либо (после будущей правки триггера) подменит серверную нумерацию.
 *
 * Храповик в стиле syncRuleGates.s06: проверяется причина, а не следствие.
 * Мутация — добавить `rev: 'rev'` в DOCUMENT_FIELDS — красная.
 */

type FieldMap = Record<string, string>;

/** Карты записи — всё, что экспортирует fields.ts с суффиксом `_FIELDS`. */
function writableFieldMaps(source: Record<string, unknown>): Record<string, FieldMap> {
  const maps: Record<string, FieldMap> = {};
  for (const [name, value] of Object.entries(source)) {
    if (!name.endsWith('_FIELDS')) continue;
    if (typeof value !== 'object' || value === null) continue;
    maps[name] = value as FieldMap;
  }
  return maps;
}

/** Имя карт, через которые клиент может записать `rev` (ключ или колонка). */
function revWriters(maps: Record<string, FieldMap>): string[] {
  const out: string[] = [];
  for (const [name, map] of Object.entries(maps)) {
    if (Object.prototype.hasOwnProperty.call(map, 'rev')) out.push(name);
    else if (Object.values(map).includes('rev')) out.push(name);
  }
  return out;
}

describe('rev is not writable through *_FIELDS (S1-4)', () => {
  it('detector itself catches a planted rev field', () => {
    expect(revWriters({ DOCUMENT_FIELDS: { uuid: 'uuid', rev: 'rev' } })).toEqual(['DOCUMENT_FIELDS']);
  });

  it('no *_FIELDS map maps a client field to rev', () => {
    const maps = writableFieldMaps(fields as unknown as Record<string, unknown>);
    expect(Object.keys(maps).length).toBeGreaterThan(4);
    expect(revWriters(maps)).toEqual([]);
  });
});
