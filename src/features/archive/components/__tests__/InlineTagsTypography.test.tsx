import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import { InlineTags } from '../InlineTags';
import { LanguageProvider, useLanguage } from '../../../../shared/i18n';

describe('D-26: InlineTags typography and localization', () => {
  it('renders a single plus on the add-tag button without double plus', () => {
    render(
      <LanguageProvider>
        <InlineTags tags={[]} onChange={vi.fn()} />
      </LanguageProvider>
    );

    const button = screen.getByRole('button', { name: 'Добавить тег' });
    expect(button.textContent?.trim()).toBe('+');
    expect(button.textContent).not.toContain('+ +');
  });

  it('uses localized Russian aria-label for remove tag button', () => {
    render(
      <LanguageProvider>
        <InlineTags tags={['test']} onChange={vi.fn()} />
      </LanguageProvider>
    );

    const removeBtn = screen.getByRole('button', { name: 'Удалить тег' });
    expect(removeBtn).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Remove Tag' })).toBeNull();
  });

  it('uses a quiet AI chat composer placeholder', () => {
    const { result } = renderHook(() => useLanguage(), { wrapper: LanguageProvider });
    const placeholder = result.current.t('ai_write_placeholder');
    expect(placeholder).toBe('Написать…');
    expect(placeholder).not.toContain('Напишите');
  });
});
