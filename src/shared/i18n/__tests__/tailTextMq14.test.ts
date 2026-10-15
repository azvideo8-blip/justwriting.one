// MQ-14: хвост «тихого языка» — «ИИ», а не «AI»; без «за меньше чем минуту» и сокращения «сл»;
// одно имя у разбора заметки; «На паузе» — состояние, а не кнопка.
import { describe, it, expect } from 'vitest';
import { commonTranslations } from '../translations/common';
import { writingTranslations } from '../translations/writing';
import { archiveTranslations } from '../translations/archive';

const ru = (t: Record<string, { ru: string }>, k: string) => t[k]?.ru;

describe('MQ-14: тексты', () => {
  it('вкладка называется «ИИ», как и везде', () => {
    expect(ru(commonTranslations, 'nav_ai_short')).toBe('ИИ');
  });

  it('«Записано N слов меньше чем за минуту» — без «за меньше чем»', () => {
    expect(ru(writingTranslations, 'finish_duration_under_minute')).toBe('меньше чем за минуту');
  });

  it('сокращения «сл» больше нет, пауза в чипе — «На паузе»', () => {
    expect(writingTranslations).not.toHaveProperty('writing_words_short');
    expect(ru(archiveTranslations, 'writing_paused_state')).toBe('На паузе');
  });

  it('разбор заметки называется одинаково в листе действий и в «Инфо»', () => {
    expect(ru(archiveTranslations, 'archive_preview_analyze_btn')).toBe(ru(writingTranslations, 'ai_note_analyze'));
  });
});
