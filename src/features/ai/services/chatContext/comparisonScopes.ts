import { MONTHS_MAP, type TemporalQuery } from '../../utils/temporalQueryParser';

// Разбор «сравни X и Y» в два скоупа (месяцы / сезоны / годы). Чистая функция
// текста — без обращения к базе или сервисам.
export function parseComparisonScopes(text: string): TemporalQuery[] {
  const isComparison = /(?:^|[^а-яёА-ЯЁa-zA-Z0-9])(?:vs|сравни|противо|по сравнению|разниц|отличи)(?![а-яёА-ЯЁa-zA-Z0-9])/i.test(text);
  if (!isComparison) return [];

  let comparisonScopes: TemporalQuery[] = [];
  const monthStems = Object.keys(MONTHS_MAP);
  const foundMonths: { stem: string; index: number; year?: number }[] = [];
  const lowerText = text.toLowerCase();
  const yearMatch = lowerText.match(/(?:^|[^0-9])(202\d)(?![0-9])/);
  const defaultYear = yearMatch ? parseInt(yearMatch[1]!, 10) : new Date().getFullYear();

  monthStems.forEach(stem => {
    let idx = lowerText.indexOf(stem);
    while (idx !== -1) {
      foundMonths.push({ stem, index: idx, year: defaultYear });
      idx = lowerText.indexOf(stem, idx + 1);
    }
  });
  foundMonths.sort((a, b) => a.index - b.index);
  const uniqueMonths = foundMonths.filter((m, i) => i === 0 || m.stem !== foundMonths[i - 1]!.stem);

  if (uniqueMonths.length >= 2) {
    comparisonScopes = uniqueMonths.slice(0, 2).map(m => ({
      type: 'month' as const,
      month: `${m.year}-${MONTHS_MAP[m.stem]!}`,
      rawText: m.stem,
    }));
  } else {
    const seasons = [
      { name: 'зима', months: ['12', '01', '02'] },
      { name: 'зим', months: ['12', '01', '02'] },
      { name: 'весна', months: ['03', '04', '05'] },
      { name: 'весн', months: ['03', '04', '05'] },
      { name: 'лето', months: ['06', '07', '08'] },
      { name: 'летн', months: ['06', '07', '08'] },
      { name: 'осень', months: ['09', '10', '11'] },
      { name: 'осен', months: ['09', '10', '11'] },
    ];
    const foundSeasons: { name: string; index: number; months: string[] }[] = [];
    seasons.forEach(s => {
      let idx = lowerText.indexOf(s.name);
      while (idx !== -1) {
        foundSeasons.push({ name: s.name, index: idx, months: s.months });
        idx = lowerText.indexOf(s.name, idx + 1);
      }
    });
    foundSeasons.sort((a, b) => a.index - b.index);
    const uniqueSeasons = foundSeasons.filter((s, i) => i === 0 || s.name !== foundSeasons[i - 1]!.name);

    if (uniqueSeasons.length >= 2) {
      comparisonScopes = uniqueSeasons.slice(0, 2).map(s => ({
        type: 'dateRange' as const,
        from: `${defaultYear}-${s.months[0]}-01`,
        to: `${defaultYear}-${s.months[2]}-30`,
        rawText: s.name,
      }));
    } else {
      const yearMatches = [...lowerText.matchAll(/(?:^|[^0-9])(202\d)(?![0-9])/g)];
      if (yearMatches.length >= 2) {
        comparisonScopes = yearMatches.slice(0, 2).map(m => ({
          type: 'dateRange' as const,
          from: `${m[1]}-01-01`,
          to: `${m[1]}-12-31`,
          rawText: m[1]!,
        }));
      }
    }
  }

  return comparisonScopes;
}
