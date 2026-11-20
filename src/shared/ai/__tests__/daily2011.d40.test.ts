// Дейлик 20.11 Н-3: ничья перевеса «вы/ты» не меняет форму посреди разговора.
// Мутация: вернуть подсчёт «по итогу» (ничья → портрет/«ты») — красный.
import { describe, it, expect } from 'vitest';
import { addressFormOf } from '../addressForm';

const u = (content: string) => ({ role: 'user', content });
const a = (content: string) => ({ role: 'assistant', content });

describe('Н-3: форма обращения не прыгает посреди разговора', () => {
  it('ход 1 на «вы», ход 2 смешал формы (ничья) — остаётся «вы»', () => {
    const turn1 = [u('Подскажите, что вы думаете об этом?')];
    expect(addressFormOf(turn1, null)).toBe('vy');
    const turn2 = [...turn1, a('Думаю, что стоит отдохнуть.'), u('Скажи, что ты думаешь')];
    expect(addressFormOf(turn2, null)).toBe('vy');
  });

  it('КОНТРОЛЬ: явный перевес «ты» — «ты»; без признаков — портрет, иначе «ты»', () => {
    expect(addressFormOf([u('Скажи, что ты думаешь, ты же видишь')], null)).toBe('ty');
    expect(addressFormOf([u('Сегодня было тихо')], 'Обращаться на «вы»')).toBe('vy');
    expect(addressFormOf([u('Сегодня было тихо')], null)).toBe('ty');
  });
});
