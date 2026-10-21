// A-8: гейт против новых самописных спиннеров. Мутация: вернуть
// `rounded-full animate-spin` в любой компонент → тест красный.
import { describe, it, expect } from 'vitest';
import { findSelfWrittenSpinners } from '../../../scripts/check-self-spinners.mjs';

describe('A-8: только LoadingSpinner/Button isLoading', () => {
  it('в src нет самописных rounded-full animate-spin', () => {
    expect(findSelfWrittenSpinners(process.cwd())).toEqual([]);
  });
});
