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

  // Явный потолок только этому тесту: в изоляции он занимает 0,15–0,6 с, но в
  // полном наборе (760 файлов, jsdom на каждый) не успевал в дефолтные 5 с —
  // `Error: Test timed out in 5000ms` в 3 прогонах из 4 13.10.2026. Общий
  // `testTimeout` в конфиге не трогаем: он есть только у этого теста, потому что
  // у всех остальных падение по умолчанию и должно оставаться сигналом.
  it('marks the changelog as seen for the current version on mount', () => {
    expect(useChangelogSeenStore.getState().hasUnseen).toBe(true);

    renderWithProviders(
      <MemoryRouter initialEntries={['/changelog']}>
        <ChangelogPage />
      </MemoryRouter>
    );

    expect(useChangelogSeenStore.getState().hasUnseen).toBe(false);
    expect(localStorage.getItem('last_seen_changelog_version')).toBe(APP_VERSION);
  }, 20_000);
});
