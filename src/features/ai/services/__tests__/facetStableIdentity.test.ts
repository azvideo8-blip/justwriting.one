// AG-MERGE-1: профиль ИИ двоился между устройствами.
// 1. id грани был `${Date.now()}_${index}` — два устройства клали одну грань
//    дважды. Теперь ключ детерминированный (ядро кластера), сборки с разных
//    устройств сходятся, а не наслаиваются.
// 2. lastReinforcedAt — строка YYYY-MM-DD: все подкрепления одного дня парсились
//    в одну полночь, и LWW-синхронизация теряла подкрепление второго устройства.
//    Теперь пишется lastReinforcedAtMs, экстрактор предпочитает его.
import { describe, it, expect, vi } from 'vitest';
import { stableFacetId } from '../AIProfileFacetBuilder';
import { extractRecordTimestamp } from '../../../../core/services/LocalStoreSyncService';

const docMap = (dates: Record<string, number>) =>
  new Map(Object.entries(dates).map(([k, v]) => [k, { lastSessionAt: v }]));

describe('AG-MERGE-1: стабильный id грани', () => {
  const notes = ['n1', 'n2', 'n3'];
  const dates = { n1: 1000, n2: 2000, n3: 3000 };

  it('одна и та же грань на двух устройствах (Date.now замокан по-разному) даёт один id', () => {
    vi.spyOn(Date, 'now').mockReturnValue(111);
    const a = stableFacetId(notes, docMap(dates));
    vi.mocked(Date.now).mockReturnValue(999_999);
    const b = stableFacetId(notes, docMap(dates));
    vi.restoreAllMocks();
    expect(a).toBe(b);
    expect(a).toMatch(/^facet_[0-9a-f]{16}$/);
  });

  it('переформулировка ярлыка суммаризатором не форкает грань — label в ключе не участвует', () => {
    // Ключ строится только на составе ядра: подпись функции его просто не принимает.
    const a = stableFacetId(notes, docMap(dates));
    expect(a).toBe(stableFacetId([...notes], docMap(dates)));
  });

  it('растущая грань сохраняет id: новая заметка моложе ядра и ключ не меняет', () => {
    // Ядро = 10 самых старых заметок; грань из 12 заметок при пополнении
    // 13-й ядро не меняет.
    const many = Array.from({ length: 12 }, (_, i) => `m${i}`);
    const manyDates = Object.fromEntries(many.map((id, i) => [id, (i + 1) * 1000]));
    const before = stableFacetId(many, docMap(manyDates));
    const grown = stableFacetId([...many, 'm-new'], docMap({ ...manyDates, 'm-new': 999_000 }));
    expect(grown).toBe(before);
  });

  it('порядок заметок в спецификации не влияет на ключ', () => {
    const a = stableFacetId(['n3', 'n1', 'n2'], docMap(dates));
    const b = stableFacetId(['n2', 'n3', 'n1'], docMap(dates));
    expect(a).toBe(b);
  });

  it('замена самой старой заметки меняет ключ (грань переродилась — это честный форк)', () => {
    const a = stableFacetId(['n2', 'n3'], docMap(dates));
    const b = stableFacetId(['n1', 'n3'], docMap(dates));
    expect(a).not.toBe(b);
  });
});

describe('AG-MERGE-1: LWW по lastReinforcedAtMs', () => {
  it('два подкрепления одной темы в один день различимы по часам', () => {
    const t1 = Date.UTC(2026, 7, 23, 9, 0, 0);
    const t2 = Date.UTC(2026, 7, 23, 21, 30, 0);
    // Устройство A: строка без числа (старая запись) — обе записи парсятся
    // в одну полночь, победителя не выбрать честно.
    const legacyA = extractRecordTimestamp({ lastReinforcedAt: '2026-08-23' });
    const legacyB = extractRecordTimestamp({ lastReinforcedAt: '2026-08-23' });
    expect(legacyA).toBe(legacyB);

    // С числовым полем: позднее подкрепление устройства B выигрывает LWW,
    // и его evidence едет в облако, а не стирается.
    const withMsA = extractRecordTimestamp({ lastReinforcedAt: '2026-08-23', lastReinforcedAtMs: t1 });
    const withMsB = extractRecordTimestamp({ lastReinforcedAt: '2026-08-23', lastReinforcedAtMs: t2 });
    expect(withMsB!).toBeGreaterThan(withMsA!);
  });

  it('строка дня остаётся для показа и остаётся фолбэком, когда числа нет', () => {
    expect(extractRecordTimestamp({ lastReinforcedAt: '2026-08-20' }))
      .toBe(Date.parse('2026-08-20'));
  });
});
