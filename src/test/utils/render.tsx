import React from 'react';
import { render } from '@testing-library/react';
import { LanguageProvider } from '../../core/i18n';

export function renderWithProviders(ui: React.ReactElement) {
  return render(
    <LanguageProvider>
      {ui}
    </LanguageProvider>
  );
}
