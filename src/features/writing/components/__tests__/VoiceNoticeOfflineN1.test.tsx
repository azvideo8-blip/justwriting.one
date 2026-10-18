// N-1 (решение владельца 2026-10-18): лист «Голосовой ввод» говорит про отсутствие
// сети до нажатия «Записать», а не постфактум тостом.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MobileVoiceNoticeSheet } from '../MobileVoiceNoticeSheet';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

function renderSheet() {
  return render(
    <MobileVoiceNoticeSheet
      open
      notice={{ vault: false, remaining: 7 }}
      onCancel={vi.fn()}
      onRecord={vi.fn()}
    />,
  );
}

describe('N-1: лист диктовки и офлайн', () => {
  beforeEach(() => { cleanup(); });
  afterEach(() => { setOnline(true); });

  it('без сети в листе есть честная строка про обработку текста', () => {
    setOnline(false);
    renderSheet();
    // Лист рендерится порталом.
    const line = document.querySelector('[data-voice-offline]');
    expect(line, 'лист молчит про отсутствие сети').toBeTruthy();
    expect(line?.textContent).toBe('voice_offline_before_start');
  });

  it('с сетью строки нет', () => {
    setOnline(true);
    renderSheet();
    expect(document.querySelector('[data-voice-offline]')).toBeNull();
  });
});
