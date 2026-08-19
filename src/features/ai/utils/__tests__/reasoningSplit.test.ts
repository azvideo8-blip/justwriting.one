import { describe, it, expect } from 'vitest';
import { extractReasoning, extractAnswer } from '../aiChatTransport';
import { sanitizeAiResponse } from '../../../../../api/ai/pure';

describe('Reasoning and Answer Extraction (Ticket 2)', () => {
  describe('extractReasoning and extractAnswer', () => {
    it('splits markdown ХОД МЫСЛИ: and ОТВЕТ: correctly', () => {
      const text = 'ХОД МЫСЛИ:\nАнализируем запрос пользователя...\nВыбираем тон поддержки.\n\nОТВЕТ:\nПривет! Рад помочь тебе с этой задачей.';
      const reasoning = extractReasoning(text);
      const answer = extractAnswer(text);

      expect(reasoning).toBe('Анализируем запрос пользователя...\nВыбираем тон поддержки.');
      expect(answer).toBe('Привет! Рад помочь тебе с этой задачей.');
    });

    it('splits XML <reasoning> and <answer> correctly', () => {
      const text = '<reasoning>\nГлубокий анализ темы...\n</reasoning>\n\n<answer>\nВот решение твоего вопроса.\n</answer>';
      const reasoning = extractReasoning(text);
      const answer = extractAnswer(text);

      expect(reasoning).toBe('Глубокий анализ темы...');
      expect(answer).toBe('Вот решение твоего вопроса.');
    });

    it('splits XML //<reasoning> comments correctly', () => {
      const text = '//<reasoning>\nРазмышляем над структурой...\n</reasoning>\n<answer>\nСтруктурированный ответ.\n</answer>';
      const reasoning = extractReasoning(text);
      const answer = extractAnswer(text);

      expect(reasoning).toBe('Размышляем над структурой...');
      expect(answer).toBe('Структурированный ответ.');
    });

    it('handles <think>...</think> and closing </think> tags', () => {
      const textWithThink = '<think>Размышления модели внутри тега</think>\nВот финальный ответ пользователю.';
      expect(extractReasoning(textWithThink)).toBe('Размышления модели внутри тега');
      expect(extractAnswer(textWithThink)).toBe('Вот финальный ответ пользователю.');

      const textClosingThinkOnly = 'Размышления до закрывающего тега</think>\nФинальный ответ.';
      expect(extractAnswer(textClosingThinkOnly)).toBe('Финальный ответ.');
    });

    it('handles standalone line ОТВЕТ: without ХОД МЫСЛИ:', () => {
      const text = 'Модель вывела мысли напрямую в контент.\n\nОТВЕТ:\nФинальный ответ.';
      const reasoning = extractReasoning(text);
      const answer = extractAnswer(text);

      expect(reasoning).toBe('Модель вывела мысли напрямую в контент.');
      expect(answer).toBe('Финальный ответ.');
    });

    it('preserves normal sentences containing the word «ответ» without delimiters unchanged', () => {
      const normal1 = 'Мой ответ: давай попробуем сделать так, как ты предлагаешь.';
      expect(extractReasoning(normal1)).toBeUndefined();
      expect(extractAnswer(normal1)).toBe('Мой ответ: давай попробуем сделать так, как ты предлагаешь.');

      const normal2 = 'В ответ на твое письмо скажу следующее: все идет по плану.';
      expect(extractReasoning(normal2)).toBeUndefined();
      expect(extractAnswer(normal2)).toBe('В ответ на твое письмо скажу следующее: все идет по плану.');

      const normal3 = 'Это отличный ответ на сложный вопрос.';
      expect(extractReasoning(normal3)).toBeUndefined();
      expect(extractAnswer(normal3)).toBe('Это отличный ответ на сложный вопрос.');
    });

    it('handles aborted reasoning stream gracefully without leaking CoT into answer', () => {
      const streamCutOffInThink = '<think>Модель начала размышлять и оборвалась';
      expect(extractReasoning(streamCutOffInThink)).toBe('Модель начала размышлять и оборвалась');
      expect(extractAnswer(streamCutOffInThink)).toBe('');

      const streamCutOffInMd = 'ХОД МЫСЛИ:\nМодель пишет рассуждения без секции ответа...';
      expect(extractReasoning(streamCutOffInMd)).toBe('Модель пишет рассуждения без секции ответа...');
      expect(extractAnswer(streamCutOffInMd)).toBe('');
    });
  });

  describe('sanitizeAiResponse', () => {
    it('strips reasoning blocks when keepReasoning is false', () => {
      const input = 'ХОД МЫСЛИ:\nСкрытые мысли...\n\nОТВЕТ:\nЧистый ответ пользователю.';
      const output = sanitizeAiResponse(input, false);
      expect(output).toBe('Чистый ответ пользователю.');
    });

    it('strips <think> tags when keepReasoning is false', () => {
      const input = '<think>Скрытые мысли</think>Ответ пользователю.';
      const output = sanitizeAiResponse(input, false);
      expect(output).toBe('Ответ пользователю.');
    });

    it('does not alter normal sentences when keepReasoning is false', () => {
      const input = 'Мой ответ: давай попробуем этот вариант.';
      const output = sanitizeAiResponse(input, false);
      expect(output).toBe('Мой ответ: давай попробуем этот вариант.');
    });
  });
});
