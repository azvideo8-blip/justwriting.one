// AG-CJK-1 (#35): вырезание CJK убрано из sanitizeAiResponse. К моменту вызова
// рассуждения уже срезаны выше (<think>, «ХОД МЫСЛИ:», <reasoning>), поэтому
// под нож попадала только цитата человека: authorPhrases, quotableSentence,
// редактура. Залётный знак в ответе виден; пропавшая цитата — нет.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { generateMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
}));

vi.mock('../ai/provider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../ai/provider')>();
  return { ...orig, generate: (...a: unknown[]) => generateMock(...(a as [])) };
});

import { sanitizeAiResponse } from '../ai/pure';

beforeEach(() => {
  generateMock.mockReset();
});

describe('AG-CJK-1: CJK в ответе человека не вырезается', () => {
  it('цитата「静」в ответе сохраняется', () => {
    // На коде до правки этот тест падает: строка с диапазонами CJK удаляет
    // цитату целиком.
    const answer = 'Он сказал: цитата「静」и это важно.';
    expect(sanitizeAiResponse(answer)).toBe(answer);
  });


  it('ответ с ХОД МЫСЛИ:/ОТВЕТ: по-прежнему отдаёт только раздел ответа', () => {
    // Охраняет соседний блок разметки — единственное, что теперь отделяет
    // рассуждения от ответа после удаления CJK-строки.
    const response = 'ХОД МЫСЛИ:\n模型は日本語で考えた\n\nОТВЕТ:\nОтвет на русском.';
    expect(sanitizeAiResponse(response)).toBe('Ответ на русском.');
  });

  it('ответ без разделов возвращается неизменным', () => {
    const plain = 'Просто текст ответа без всякой разметки.';
    expect(sanitizeAiResponse(plain)).toBe(plain);
  });
});
