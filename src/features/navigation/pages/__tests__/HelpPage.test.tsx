import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { HelpPage } from '../HelpPage';

vi.mock('../../../../shared/i18n/SeoHead', () => ({
  SeoHead: () => <div data-testid="seo-head" />,
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

describe('HelpPage (UI-12)', () => {
  it('renders page title and troubleshooting section', () => {
    renderWithProviders(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Помощь' })).toBeInTheDocument();
    expect(screen.getByText('Заметки не видны?')).toBeInTheDocument();
  });
});
