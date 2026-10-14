import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLanguage, LanguageProvider } from '../shared/i18n';

/** Подсказка на письме обращается к человеку от первого лица, и мужская форма
 *  прошедшего времени («думал», «хотел», «боялся») читается как «ты — мужчина».
 *  Цитаты внутри строки не считаем: там голос героя, а не обращение. */
// «л» кириллическая, а `\b` в JS считает словами только ASCII — на `/л\b/`
// такое окончание не ловится, поэтому граница слова задана явно.
const MASCULINE_PAST = /[а-яё]л(?!\p{L})|лся(?!\p{L})/iu;

const PROMPT_KEYS = [
  'prompt_morning_1', 'prompt_morning_2', 'prompt_morning_3',
  'prompt_reflect_1', 'prompt_reflect_2', 'prompt_reflect_3',
  'prompt_creative_1', 'prompt_creative_2', 'prompt_creative_3',
];

const outsideQuotes = (value: string) => value.replace(/«[^»]*»/g, '');

function translate() {
  const { result } = renderHook(() => useLanguage(), { wrapper: LanguageProvider });
  return result.current.t;
}

describe('MC-9: подсказка дня и заглушки без рода', () => {
  it('ни одна подсказка не окончена мужской формой прошедшего времени', () => {
    const t = translate();
    for (const key of PROMPT_KEYS) {
      const value = t(key);
      expect(value, key).not.toBe(key);
      expect(outsideQuotes(value), key).not.toMatch(MASCULINE_PAST);
    }
  });

  it('мобильная заглушка редактора — тихая строка без рода', () => {
    const t = translate();
    expect(t('writing_placeholder_mobile')).toBe('О чём думается сегодня?');
  });

  it('согласие на шифрование говорит про устройство, а не про пол человека', () => {
    const t = translate();
    expect(t('enc_recovery_remember_device')).toBe(
      'Это моё устройство. Не спрашивать здесь пароль шифрования',
    );
    expect(t('enc_recovery_code_confirm_checkbox')).toBe('Код сохранён в надёжном месте');
  });
});
