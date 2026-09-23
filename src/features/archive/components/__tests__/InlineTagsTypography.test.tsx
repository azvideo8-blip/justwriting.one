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

    const button = screen.getByRole('button');
    expect(button.textContent?.trim()).toBe('+ тег');
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

  it('formats AI chat placeholder with "Сообщение для: {name}…"', () => {
    const { result } = renderHook(() => useLanguage(), { wrapper: LanguageProvider });
    const placeholder = result.current.t('ai_write_placeholder', { name: 'Группа психологов' });
    expect(placeholder).toBe('Сообщение для: Группа психологов…');
    expect(placeholder).not.toContain('Напишите');
  });
});
