import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../../shared/i18n';
import { authScreensTranslations } from '../../../shared/i18n/translations/authScreens';
import { RestoreFromCloudModal } from '../../../app/modals/RestoreFromCloudModal';
import { InviteWizard } from '../components/InviteWizard';
import { IndexingConsentModal } from '../../ai/components/IndexingConsentModal';
import { OtherUserDataModal } from '../components/OtherUserDataModal';
import { PrivacyModal } from '../components/PrivacyModal';

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'u123', email: 'test@example.com' }),
}));

vi.mock('../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u123' }, loading: false }),
}));

vi.mock('../../../core/services/LocalStorageService', () => ({
  LocalStorageService: {
    getDocumentsByOwner: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../core/services/DocumentService', () => ({
  DocumentService: {
    getUserDocuments: vi.fn().mockResolvedValue([]),
  },
}));

function renderInEnglish(ui: React.ReactElement) {
  localStorage.setItem('app_language', 'en');
  return render(
    <LanguageProvider>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </LanguageProvider>
  );
}

describe('T-1 (a) User-facing dialogs English localization (no Cyrillic characters)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('RestoreFromCloudModal has no Cyrillic text when rendered in English', () => {
    const { container } = renderInEnglish(
      <RestoreFromCloudModal
        open={true}
        onClose={() => {}}
        initialLocalCount={0}
        initialCloudCount={5}
      />
    );
    expect(container.innerHTML).not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('InviteWizard has no Cyrillic text when rendered in English', () => {
    const { container } = renderInEnglish(
      <InviteWizard email="test@example.com" />
    );
    expect(container.innerHTML).not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('IndexingConsentModal has no Cyrillic text when rendered in English', () => {
    const { container } = renderInEnglish(
      <IndexingConsentModal
        isOpen={true}
        onConsent={() => {}}
        onRefuse={() => {}}
      />
    );
    expect(container.innerHTML).not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('OtherUserDataModal has no Cyrillic text when rendered in English', () => {
    const { container } = renderInEnglish(
      <OtherUserDataModal
        open={true}
        onClose={() => {}}
        onClear={async () => {}}
      />
    );
    expect(container.innerHTML).not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('PrivacyModal has no Cyrillic text when rendered in English', () => {
    const { container } = renderInEnglish(
      <PrivacyModal onAccepted={() => {}} />
    );
    expect(container.innerHTML).not.toMatch(/[а-яёА-ЯЁ]/);
  });

  // FX-4: экран согласия читает человек, а не разработчик. Внутренний жаргон
  // («хоп», «second hop») в этом тексте появляться не может — ни на одном языке.
  it('в тексте про третьи стороны нет внутреннего жаргона ни в ru, ни в en', () => {
    const entry = authScreensTranslations.privacy_consent_third_party_p3;
    expect(entry, 'ключ переименован — проверка стала бы вакуумной').toBeDefined();
    expect(entry?.ru.toLowerCase()).not.toMatch(/хоп/);
    expect(entry?.en.toLowerCase()).not.toMatch(/\bhop\b/);
  });
});

function renderInRussian(ui: React.ReactElement) {
  localStorage.setItem('app_language', 'ru');
  return render(
    <LanguageProvider>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </LanguageProvider>
  );
}

describe('T-1 (a) Russian rendering unchanged', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('RestoreFromCloudModal matches Russian snapshot', () => {
    const { container } = renderInRussian(
      <RestoreFromCloudModal
        open={true}
        onClose={() => {}}
        initialLocalCount={0}
        initialCloudCount={5}
      />
    );
    expect(container.textContent).toMatchSnapshot();
  });

  it('InviteWizard matches Russian snapshot', () => {
    const { container } = renderInRussian(
      <InviteWizard email="test@example.com" />
    );
    expect(container.textContent).toMatchSnapshot();
  });

  it('IndexingConsentModal matches Russian snapshot', () => {
    const { container } = renderInRussian(
      <IndexingConsentModal
        isOpen={true}
        onConsent={() => {}}
        onRefuse={() => {}}
      />
    );
    expect(container.textContent).toMatchSnapshot();
  });

  it('OtherUserDataModal matches Russian snapshot', () => {
    const { container } = renderInRussian(
      <OtherUserDataModal
        open={true}
        onClose={() => {}}
        onClear={async () => {}}
      />
    );
    expect(container.textContent).toMatchSnapshot();
  });

  it('PrivacyModal matches Russian snapshot', () => {
    const { container } = renderInRussian(
      <PrivacyModal onAccepted={() => {}} />
    );
    expect(container.textContent).toMatchSnapshot();
  });
});

