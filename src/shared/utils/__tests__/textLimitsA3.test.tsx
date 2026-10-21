// A-3/A-4: лимиты не режут эмодзи пополам. Проверяем helper, настоящий стор
// тегов, поле имени персоны и инициал профиля — то, что видит человек.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { truncateText, textLength, firstTextUnit } from '../textLimits';
import { useContentStore } from '../../../features/writing/store/useContentStore';
import { CreatePersonaModal } from '../../../features/ai/components/CreatePersonaModal';
import { ProfileHero } from '../../../features/profile/components/ProfileHero';
import { ToastProvider } from '../../../shared/components/Toast';
import { LanguageProvider } from '../../../shared/i18n';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

vi.mock('../../../features/ai/services/AIPersonaService', () => ({
  AIPersonaService: { validate: vi.fn(), create: vi.fn() },
}));

function renderRu(ui: React.ReactElement) {
  localStorage.setItem('language', 'ru');
  return render(
    <ToastProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ToastProvider>,
  );
}

describe('A-3: лимиты и эмодзи', () => {
  afterEach(cleanup);

  it('helper режет по графемам и не даёт одиночного суррогата', () => {
    const input = 'а'.repeat(29) + '😀';
    const cut = truncateText(input, 30);
    expect(cut).toBe(input);
    expect(LONE_SURROGATE.test(cut)).toBe(false);
    expect(textLength('😀')).toBe(1);
    expect(LONE_SURROGATE.test(truncateText('а'.repeat(29) + '😀', 29))).toBe(false);

    const family = '👨‍👩‍👧‍👦';
    expect(truncateText('а'.repeat(29) + family, 30)).toBe('а'.repeat(29) + family);
    expect(firstTextUnit('😀абв')).toBe('😀');
  });

  it('ревью 0.10.7: предел в UTF-16 для полей с серверным zod max — эмодзи не выводят строку за него', () => {
    const prompt = 'а'.repeat(499) + '😀'.repeat(10);
    const cut = truncateText(prompt, 500, { maxCodeUnits: 500 });
    expect(cut.length).toBeLessThanOrEqual(500);
    expect(cut).toBe('а'.repeat(499));
    expect(truncateText('😀'.repeat(400), 500, { maxCodeUnits: 500 })).toBe('😀'.repeat(250));
  });

  it('тег на границе 50 хранится целым и без одиночного суррогата', () => {
    const tag = 'т'.repeat(49) + '😀';
    useContentStore.getState().setTags([tag]);
    const stored = useContentStore.getState().tags[0]!;
    expect(stored).toBe(tag);
    expect(LONE_SURROGATE.test(stored)).toBe(false);
    expect(textLength(stored)).toBe(50);
  });

  it('имя персоны на границе 30 не режется пополам', () => {
    renderRu(<CreatePersonaModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    const nameInput = screen.getAllByRole('textbox')[0]!;
    const value = 'а'.repeat(29) + '😀';
    fireEvent.change(nameInput, { target: { value } });

    expect((nameInput as HTMLInputElement).value).toBe(value);
    expect(LONE_SURROGATE.test((nameInput as HTMLInputElement).value)).toBe(false);
    expect(screen.getByText('30/30')).toBeTruthy();
  });

  it('инициал эмодзи-имени цел', () => {
    const { container } = renderRu(
      <ProfileHero
        user={{ uid: 'u1', email: 'u@example.com', displayName: '😀абв', photoURL: null, metadata: { creationTime: new Date().toISOString(), lastSignInTime: null } }}
        profile={{ nickname: '😀абв' } as never}
        isGuest={false}
        onStartSession={vi.fn()}
      />,
    );
    const avatar = container.querySelector('div.w-16.h-16');
    expect(avatar).not.toBeNull();
    expect(within(avatar as HTMLElement).getByText('😀')).toBeTruthy();
  });
});
