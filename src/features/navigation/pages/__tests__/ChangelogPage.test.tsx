import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { ChangelogPage } from '../ChangelogPage';
import { useChangelogSeenStore } from '../../../../shared/changelog/useChangelogSeenStore';
import { APP_VERSION } from '../../../../version';

describe('ChangelogPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('marks the changelog as seen for the current version on mount', () => {
    expect(useChangelogSeenStore.getState().hasUnseen).toBe(true);

    renderWithProviders(
      <MemoryRouter initialEntries={['/changelog']}>
        <ChangelogPage />
      </MemoryRouter>
    );

    expect(useChangelogSeenStore.getState().hasUnseen).toBe(false);
    expect(localStorage.getItem('last_seen_changelog_version')).toBe(APP_VERSION);
  });
});
