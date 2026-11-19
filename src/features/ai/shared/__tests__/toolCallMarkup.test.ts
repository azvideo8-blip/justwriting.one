// Разбор 18.11 (вечер): на «Посмотри в других моих записях» deepseek вместо
// ответа выдал свою разметку вызова инструмента (DSML) — она легла в чат как
// текст. Разметка становится кнопкой поиска [[ПОИСК: …]], сырой текст не виден.
// Мутация, на которой тест краснеет: вернуть текст без замены.
import { describe, expect, it } from 'vitest';
import { toolCallToSearchMarker, extractSearchRequest } from '../citationPatterns';

const GLITCH = `<｜｜DSML｜｜ calls>
<｜｜DSML｜｜ invoke name="search_notes">
<｜｜DSML｜｜ parameter name="query" string="true">заслужить любовь родительская условие награда</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>`;

describe('разметка вызова инструмента в ответе', () => {
  it('целиком — становится запросом поиска', () => {
    const out = toolCallToSearchMarker(GLITCH);
    expect(out).not.toContain('DSML');
    expect(extractSearchRequest(out)).toBe('заслужить любовь родительская условие награда');
  });
  it('текст до разметки остаётся', () => {
    expect(toolCallToSearchMarker(`Посмотрю.\n${GLITCH}`).startsWith('Посмотрю.')).toBe(true);
  });
  it('обрыв посреди стрима — хвост с разметкой не показывается', () => {
    expect(toolCallToSearchMarker('Посмотрю. <｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ inv')).toBe('Посмотрю. ');
  });
  it('обычный ответ — без изменений', () => {
    const t = 'Обычный ответ [#local_1] с ссылкой.';
    expect(toolCallToSearchMarker(t)).toBe(t);
  });
});
