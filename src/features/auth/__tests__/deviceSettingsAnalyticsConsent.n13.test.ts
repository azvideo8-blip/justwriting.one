// N1-3 (дейлик 01.11, подозрение): `DEVICE_SETTINGS_KEYS` держал `analytics_consent`
// — ключ PostHog-аналитики, которую убрали из приложения в 619975e9 (20.09.2026,
// OUT-1..7: удалены `src/core/analytics/analytics.ts` и `webVitals.ts`). В `src/`
// его больше не читает и не пишет никто, а решение об ИИ живёт по аккаунту
// (`src/core/ai/aiConsent.ts`, `privacy_accepted_${uid}`), не по устройству.
// Мёртвая запись в белом списке означала, что байт старой версии переживает
// «стереть всё с этого компьютера» вечно.
// Мутация: вернуть `analytics_consent` в белый список → первый тест красный.
import { describe, it, expect, beforeEach } from 'vitest';
import { clearAccountScopedStorage } from '../services/accountScopedKeys';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

const USER = 'u_n1_device_keys';
const OTHER = 'u_n1_other_account';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('N1-3: мёртвый analytics_consent больше не настройка устройства', () => {
  it('оставленный старой версией analytics_consent стирается выходом с очищением', () => {
    // Так его писала версия до 619975e9 (src/core/analytics/analytics.ts:55 в том коммите).
    localStorage.setItem('analytics_consent', 'true');

    clearAccountScopedStorage(USER);

    expect(localStorage.getItem('analytics_consent')).toBeNull();
  });

  it('контроль: живые настройки устройства переживают выход любого аккаунта', () => {
    localStorage.setItem(STORAGE_KEYS.APP_THEME, 'dark');
    localStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, 'en');
    localStorage.setItem('layout-mode-v4', 'focus');
    localStorage.setItem(STORAGE_KEYS.PREVIEW_WIDTH, '480');
    localStorage.setItem(STORAGE_KEYS.DIAGNOSTICS_UNLOCKED, '1');

    clearAccountScopedStorage(USER);

    expect(localStorage.getItem(STORAGE_KEYS.APP_THEME)).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEYS.APP_LANGUAGE)).toBe('en');
    expect(localStorage.getItem('layout-mode-v4')).toBe('focus');
    expect(localStorage.getItem(STORAGE_KEYS.PREVIEW_WIDTH)).toBe('480');
    expect(localStorage.getItem(STORAGE_KEYS.DIAGNOSTICS_UNLOCKED)).toBe('1');
  });

  it('контроль: ключ аккаунта стёрт, чужой аккаунт защищён', () => {
    localStorage.setItem(STORAGE_KEYS.DRAFT(USER), 'мой черновик');
    localStorage.setItem(STORAGE_KEYS.DRAFT(OTHER), 'черновик другого');

    clearAccountScopedStorage(USER);

    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(USER))).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(OTHER))).toBe('черновик другого');
  });
});
