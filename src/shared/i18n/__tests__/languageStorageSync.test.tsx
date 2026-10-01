import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '../index';
import { STORAGE_KEYS } from '../../constants/storageKeys';

describe('S-24 (R6Q-035) LanguageProvider syncs language across tabs via storage event', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('switches language when a storage event for APP_LANGUAGE fires', async () => {
    localStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, 'ru');

    function DisplayLanguage() {
      const { language } = useLanguage();
      return <span data-testid="current-language">{language}</span>;
    }

    render(
      <LanguageProvider>
        <DisplayLanguage />
      </LanguageProvider>
    );

    expect(screen.getByTestId('current-language')).toHaveTextContent('ru');

    // Simulate another tab changing the language in localStorage
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: STORAGE_KEYS.APP_LANGUAGE,
          newValue: 'en',
          oldValue: 'ru',
        })
      );
    });

    expect(screen.getByTestId('current-language')).toHaveTextContent('en');
  });
});
