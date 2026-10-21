// A-5/A-6: направление ввода auto и имя профиля — с пределом и trim.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProfileHero } from '../ProfileHero';
import { Input } from '../../../../shared/components/Input';
import { Textarea } from '../../../../shared/components/Textarea';
import { ProfileService } from '../../../../core/services/ProfileService';
import { DataProvider } from '../../../../core/data';
import { ToastProvider } from '../../../../shared/components/Toast';
import { LanguageProvider } from '../../../../shared/i18n';
import type { AppUser } from '../../../../core/auth/types';

function renderRu(ui: React.ReactElement) {
  localStorage.setItem('language', 'ru');
  return render(
    <ToastProvider><LanguageProvider>{ui}</LanguageProvider></ToastProvider>,
  );
}

const USER: AppUser = {
  uid: 'u-a6',
  email: 'marker@example.com',
  displayName: 'Имя',
  photoURL: null,
  metadata: { creationTime: new Date().toISOString(), lastSignInTime: null },
};

describe('A-5: dir="auto"', () => {
  afterEach(cleanup);

  it('Input и Textarea выставляют dir=auto по умолчанию', () => {
    const { container } = render(
      <div><Input aria-label="i" /><Textarea aria-label="t" /></div>,
    );
    expect(container.querySelector('input')!.getAttribute('dir')).toBe('auto');
    expect(container.querySelector('textarea')!.getAttribute('dir')).toBe('auto');
  });
});

describe('A-6: имя профиля', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('сервис сам режет пробелы и не пишет пустое', async () => {
    const write = vi.spyOn(DataProvider, 'updateProfile').mockResolvedValue(undefined as never);

    await ProfileService.updateNickname('u-a6', '  Мария  ');
    expect(write).toHaveBeenCalledWith('u-a6', { nickname: 'Мария' });

    write.mockClear();
    await ProfileService.updateNickname('u-a6', '   ');
    expect(write).not.toHaveBeenCalled();
  });

  it('сохраняет имя без краевых пробелов', async () => {
    const update = vi.spyOn(ProfileService, 'updateNickname').mockResolvedValue(undefined);
    renderRu(<ProfileHero user={USER} profile={null} isGuest={false} onStartSession={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Изменить имя' }));
    const field = screen.getByRole('textbox', { name: 'Имя' });
    expect(field.getAttribute('maxlength')).toBe('60');
    fireEvent.change(field, { target: { value: '  Мария  ' } });
    fireEvent.blur(field);

    await waitFor(() => expect(update).toHaveBeenCalledWith('u-a6', 'Мария'));
  });
});
