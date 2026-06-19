import { describe, it, expect } from 'vitest';
import { analyzeDoors, aggregateDoors } from '../contactDoors';

describe('analyzeDoors', () => {
  it('detects thinking-dominant text', () => {
    const text = 'Я думаю об этом постоянно. Кажется, я понимаю, в чём дело. Мои размышления приводят к выводу, что логично предположить такой план.';
    const result = analyzeDoors(text);
    expect(result.thinking).toBeGreaterThan(result.feeling);
    expect(result.thinking).toBeGreaterThan(result.behavior);
    expect(result.lowData).toBe(false);
  });

  it('detects feeling-dominant text', () => {
    const text = 'Мне так грустно и тревожно. Чувствую обиду и злость. Страшно, что ничего не изменится. Но при этом чувствую благодарность.';
    const result = analyzeDoors(text);
    expect(result.feeling).toBeGreaterThan(result.thinking);
    expect(result.feeling).toBeGreaterThan(result.behavior);
  });

  it('detects behavior-dominant text', () => {
    const text = 'Я пошёл в магазин, купил продукты, приготовил ужин, позвонил маме, помыл посуду, лёг спать.';
    const result = analyzeDoors(text);
    expect(result.behavior).toBeGreaterThan(result.thinking);
    expect(result.behavior).toBeGreaterThan(result.feeling);
  });

  it('returns lowData for empty text', () => {
    const result = analyzeDoors('');
    expect(result.lowData).toBe(true);
    expect(result.total).toBe(0);
  });

  it('returns lowData for text without markers', () => {
    const result = analyzeDoors('Просто какой-то текст без маркеров дверей.');
    expect(result.lowData).toBe(true);
    expect(result.total).toBe(0);
  });

  it('returns lowData for very few markers', () => {
    const result = analyzeDoors('Подумаю об этом.');
    expect(result.lowData).toBe(true);
    expect(result.total).toBeLessThan(5);
  });

  it('negation does not change door', () => {
    const text = 'Не злюсь, не боюсь, не грустно — но чувствую спокойствие.';
    const result = analyzeDoors(text);
    expect(result.feeling).toBeGreaterThan(0);
  });
});

describe('aggregateDoors', () => {
  it('returns lowData for empty input', () => {
    const result = aggregateDoors([]);
    expect(result.lowData).toBe(true);
    expect(result.thinnestDoor).toBeNull();
  });

  it('computes dominant and thinnest doors', () => {
    const notes = [
      { doors: analyzeDoors('Думаю, размышляю, анализирую, понимаю, считаю, что вывод очевиден. Размышляю и обдумываю. Идея, концепция, смысл.'), ts: Date.now() },
      { doors: analyzeDoors('Думаю снова, мысль появилась, рассуждаю, понимаю больше. Размышляю и анализирую. Гипотеза, теория, факт.'), ts: Date.now() },
      { doors: analyzeDoors('Думаю, размышляю, рассуждаю, анализирую, понимаю, обдумываю, осмысляю. Вывод, заключение, суждение.'), ts: Date.now() },
      { doors: analyzeDoors('Чувствую радость, грусть, тревогу, страх, обиду, стыд, благодарность, нежность, тепло.'), ts: Date.now() },
      { doors: analyzeDoors('Пошёл в магазин, купил продукты, приготовил ужин, позвонил маме, помыл посуду, убрал квартиру.'), ts: Date.now() },
      { doors: analyzeDoors('Сделал зарядку, поехал на работу, встретился с другом, пообедал, вернулся домой, прочитал книгу.'), ts: Date.now() },
    ];
    const result = aggregateDoors(notes);
    expect(result.lowData).toBe(false);
    expect(result.dominantDoor).toBe('thinking');
    // feeling and behavior are close; thinnest is one of them (not thinking)
    expect(result.thinnestDoor).not.toBe('thinking');
  });

  it('aggregates by month', () => {
    const notes = [
      { doors: analyzeDoors('Думаю, размышляю, анализирую, понимаю, считаю, размышляю, обдумываю.'), ts: new Date('2026-01-15').getTime() },
      { doors: analyzeDoors('Чувствую, ощущаю, злюсь, боюсь, грустно, тревожно, обижен, страшно.'), ts: new Date('2026-02-15').getTime() },
    ];
    const result = aggregateDoors(notes);
    expect(result.byPeriod).toHaveLength(2);
    expect(result.byPeriod[0]!.period).toBe('2026-01');
    expect(result.byPeriod[0]!.thinking).toBeGreaterThan(result.byPeriod[0]!.feeling);
    expect(result.byPeriod[1]!.feeling).toBeGreaterThan(result.byPeriod[1]!.thinking);
  });
});
