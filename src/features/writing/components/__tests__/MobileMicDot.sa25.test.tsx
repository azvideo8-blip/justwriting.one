// SA-25: жёлтая точка у микрофона объясняла себя только в aria-label. После
// листа MF-5 (человек нажал «Записать») при открытом сейфе она молчит; запертый
// сейф или ни разу не виденный лист — точка остаётся.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MobileWriteToolbar } from '../MobileWriteToolbar';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

const enc = vi.hoisted(() => ({ unlocked: true }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => ({ isListening: false, phase: 'idle', toggle: vi.fn(), hasSupport: true, isVaultActive: true, aiNoticeRemaining: null }),
}));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: (cb: (s: { isVaultUnlocked: boolean }) => unknown) => cb({ isVaultUnlocked: enc.unlocked }),
}));

const dot = () => document.querySelector('[title="voice_vault_badge"]');
const mic = () => screen.getByRole('button', { name: /voice_start/ });

describe('SA-25: the vault dot at the microphone', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); enc.unlocked = true; });

  it('notice never seen: the dot and the warning outline are there', () => {
    render(<MobileWriteToolbar onStop={vi.fn()} />);
    expect(dot()).not.toBeNull();
    expect(mic().className).toContain('border-accent-warning');
  });

  it('notice seen and the vault open: no dot, no yellow outline', () => {
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2, '1');
    render(<MobileWriteToolbar onStop={vi.fn()} />);
    expect(dot()).toBeNull();
    expect(mic().className).not.toContain('border-accent-warning');
    // Смысл остаётся для чтеца с экрана.
    expect(mic().getAttribute('aria-label')).toContain('voice_vault_badge');
  });

  it('notice seen but the vault is locked: the dot stays', () => {
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2, '1');
    enc.unlocked = false;
    render(<MobileWriteToolbar onStop={vi.fn()} />);
    expect(dot()).not.toBeNull();
  });
});
