import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AccountDeleteSection } from '../components/AccountDeleteSection';
import { ConfirmDialogRenderer } from '../../../shared/components/ConfirmDialog';
import { LanguageProvider } from '../../../shared/i18n';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { settingsTranslations } from '../../../shared/i18n/translations/settings';

// S-28 (O-5): о том, что стирается на этом устройстве сверх базы аккаунта, и о
// том, что остаётся на других, человек должен узнать до подтверждения. Проверяем
// по смыслу сказанного, а не по ссылке на перевод: краснеть тест обязан из-за
// того, чего человек не видит, а не из-за отсутствующего ключа.

vi.mock('../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isAuthenticated: true }) }));
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

function renderIn(lang: 'ru' | 'en') {
  localStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, lang);
  return render(
    <LanguageProvider>
      <AccountDeleteSection userId="u_dialog" />
      <ConfirmDialogRenderer />
    </LanguageProvider>,
  );
}

function openConfirm(lang: 'ru' | 'en'): string {
  renderIn(lang);
  fireEvent.click(screen.getByRole('button', {
    name: lang === 'ru'
      ? settingsTranslations.settings_delete_account_button!.ru
      : settingsTranslations.settings_delete_account_button!.en,
  }));
  return screen.getByRole('dialog').textContent ?? '';
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('S-28: the deletion dialog warns before confirming', () => {
  it('RU says the guest database goes too and other devices keep a copy', () => {
    const dialog = openConfirm('ru');
    expect(dialog).toMatch(/гостевая база/i);
    expect(dialog).toMatch(/на других устройствах/i);
    expect(dialog).toMatch(/очисткой данных/i);
  });

  it('EN carries the same two warnings', () => {
    const dialog = openConfirm('en');
    expect(dialog).toMatch(/guest database/i);
    expect(dialog).toMatch(/other devices/i);
    expect(dialog).toMatch(/data clearing/i);
  });
});
