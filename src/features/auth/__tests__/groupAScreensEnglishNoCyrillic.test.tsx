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


/** Портал (MB-4) выносит окно в document.body. Смотреть надо на отрендеренное
 *  целиком: container после портала пуст, и проверка «нет кириллицы» прошла бы
 *  на пустоте, а снимок усох бы до нуля. */
function renderedHtml(): string {
  return document.body.innerHTML;
}

function renderedText(): string {
  return document.body.textContent ?? '';
}

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
    renderInEnglish(
      <RestoreFromCloudModal
        open={true}
        onClose={() => {}}
        initialLocalCount={0}
        initialCloudCount={5}
      />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('InviteWizard has no Cyrillic text when rendered in English', () => {
    renderInEnglish(
      <InviteWizard email="test@example.com" />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('IndexingConsentModal has no Cyrillic text when rendered in English', () => {
    renderInEnglish(
      <IndexingConsentModal
        isOpen={true}
        onConsent={() => {}}
        onRefuse={() => {}}
      />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('OtherUserDataModal has no Cyrillic text when rendered in English', () => {
    renderInEnglish(
      <OtherUserDataModal
        open={true}
        onClose={() => {}}
        onClear={async () => {}}
      />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('PrivacyModal has no Cyrillic text when rendered in English', () => {
    renderInEnglish(
      <PrivacyModal onAccepted={() => {}} />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
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
    renderInRussian(
      <RestoreFromCloudModal
        open={true}
        onClose={() => {}}
        initialLocalCount={0}
        initialCloudCount={5}
      />
    );
    expect(renderedText().length, 'портал уехал из снимка').toBeGreaterThan(30);
    expect(renderedText()).toMatchSnapshot();
  });

  it('InviteWizard matches Russian snapshot', () => {
    renderInRussian(
      <InviteWizard email="test@example.com" />
    );
    expect(renderedText().length, 'портал уехал из снимка').toBeGreaterThan(30);
    expect(renderedText()).toMatchSnapshot();
  });

  it('IndexingConsentModal matches Russian snapshot', () => {
    renderInRussian(
      <IndexingConsentModal
        isOpen={true}
        onConsent={() => {}}
        onRefuse={() => {}}
      />
    );
    expect(renderedText().length, 'портал уехал из снимка').toBeGreaterThan(30);
    expect(renderedText()).toMatchSnapshot();
  });

  it('OtherUserDataModal matches Russian snapshot', () => {
    renderInRussian(
      <OtherUserDataModal
        open={true}
        onClose={() => {}}
        onClear={async () => {}}
      />
    );
    expect(renderedText().length, 'портал уехал из снимка').toBeGreaterThan(30);
    expect(renderedText()).toMatchSnapshot();
  });

  it('PrivacyModal matches Russian snapshot', () => {
    renderInRussian(
      <PrivacyModal onAccepted={() => {}} />
    );
    expect(renderedText().length, 'портал уехал из снимка').toBeGreaterThan(30);
    expect(renderedText()).toMatchSnapshot();
  });
});

