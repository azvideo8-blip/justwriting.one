import { describe, expect, it } from 'vitest';
import { detectAuthorGender } from '../authorGender';

// PR-10 (18.2): род автора — из форм прошедшего времени от первого лица в
// текстах этого хода. Прилагательное «рад» рода не выдаёт.
describe('PR-10: род автора по формам прошедшего времени', () => {
  it('мужской род', () => {
    expect(detectAuthorGender('Вчера я проснулся рано и долго сидел у окна.')).toBe('m');
  });

  it('женский род', () => {
    expect(detectAuthorGender('Вчера я проснулась рано и долго сидела у окна.')).toBe('f');
  });

  it('смешанные формы — род не передан', () => {
    expect(detectAuthorGender('Я сказал одно, а потом я сказала другое.')).toBeNull();
  });

  it('форм нет — род не передан', () => {
    expect(detectAuthorGender('Утро. Тихо. Надо собираться.')).toBeNull();
    expect(detectAuthorGender('')).toBeNull();
    expect(detectAuthorGender(null)).toBeNull();
  });

  it('«я был рад» — род по глаголу, а «рад» сам по себе рода не даёт', () => {
    expect(detectAuthorGender('Я был рад этому.')).toBe('m');
    expect(detectAuthorGender('Я рад.')).toBeNull();
    expect(detectAuthorGender('Я рада.')).toBeNull();
  });

  it('глагол через наречие — всё равно находится', () => {
    expect(detectAuthorGender('Я тогда очень устала и легла рано.')).toBe('f');
  });
});
