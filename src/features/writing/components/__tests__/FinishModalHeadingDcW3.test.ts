// DC-W3: заголовок итогов — одна строка «Записано N слов за M минут».
// Тест собирает её из настоящих ru-переводов и русских правил множественного
// числа, поэтому ловит и отсутствующий ключ, и неверную форму («5 слово»).
import { describe, it, expect } from 'vitest';
import { translations } from '../../../../shared/i18n';
import { buildFinishHeading } from '../WritingFinishModal';

type Params = Record<string, string | number>;

const ruOf = (key: string, params?: Params): string => {
  let str = translations[key]?.ru ?? key;
  for (const [name, value] of Object.entries(params ?? {})) {
    str = str.split(`{${name}}`).join(String(value));
  }
  return str;
};

const ruSuffix = (n: number): string => {
  if (n % 10 === 1 && n % 100 !== 11) return '_one';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return '_few';
  return '_many';
};

const t = (key: string, params?: Params) => ruOf(key, params);
const tp = (key: string, count: number) => ruOf(`${key}${ruSuffix(count)}`, { count });

const heading = (sessionWords: number, sessionSeconds: number, quietStats = false) =>
  buildFinishHeading({ sessionWords, sessionSeconds, quietStats, t, tp });

describe('DC-W3: заголовок окна итогов', () => {
  it('склоняет слово «слово»', () => {
    expect(heading(1, 120)).toBe('Записано 1 слово за 2 минуты');
    expect(heading(2, 120)).toBe('Записано 2 слова за 2 минуты');
    expect(heading(5, 120)).toBe('Записано 5 слов за 2 минуты');
    expect(heading(21, 120)).toBe('Записано 21 слово за 2 минуты');
  });

  it('склоняет минуты', () => {
    expect(heading(10, 60)).toBe('Записано 10 слов за 1 минуту');
    expect(heading(10, 180)).toBe('Записано 10 слов за 3 минуты');
    expect(heading(10, 660)).toBe('Записано 10 слов за 11 минут');
  });

  it('собирает пример из тикета', () => {
    expect(heading(312, 14 * 60)).toBe('Записано 312 слов за 14 минут');
  });

  it('меньше минуты — без числа', () => {
    expect(heading(3, 41)).toBe('Записано 3 слова меньше чем за минуту');
  });

  it('«Записано.» без слов и в режиме «Писать без цифр»', () => {
    expect(heading(0, 600)).toBe('Записано.');
    expect(heading(312, 840, true)).toBe('Записано.');
  });
});
