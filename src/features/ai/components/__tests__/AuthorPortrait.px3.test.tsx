// PX-3: при открытии раздела «ИИ-профиль» ни одного обращения к ИИ не происходит.
// Правило из useBackgroundSync.ts: без нажатия человека текст к поставщику не
// уходит — конвейер, который сам гонял сводки, грани и портрет по таймеру, убран
// целиком (0.9.34). Устаревший портрет поэтому только помечается тихой строкой.
//
// Мутация: добавить `void AIProfileService.generate()` в эффект монтирования —
// тест «при открытии ни одного вызова ИИ» краснеет.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { LanguageProvider } from '../../../../shared/i18n';

const { mockProfile, mockChat } = vi.hoisted(() => ({
  mockProfile: {
    getPortrait: vi.fn(),
    isPortraitStale: vi.fn(),
    generate: vi.fn(),
    exportMarkdown: vi.fn(),
  },
  mockChat: vi.fn(),
}));

vi.mock('../../services/AIProfileService', () => ({ AIProfileService: mockProfile }));
vi.mock('../../services/AIService', () => ({ AIService: { chat: mockChat } }));
vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: async () => ({ getAll: async () => [] }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

import { AuthorPortrait } from '../AuthorPortrait';

const PORTRAIT = '# Психологический портрет пользователя\n\n## Стиль общения\nОбращение на «ты», короткие ответы.';
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: LanguageProvider });

describe('PX-3: устаревший портрет — метка без вызова ИИ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockProfile.getPortrait.mockResolvedValue(PORTRAIT);
    mockProfile.isPortraitStale.mockResolvedValue(true);
  });

  it('тихая строка показывается, когда версия промптов расходится', async () => {
    render(<AuthorPortrait readOnly />);

    expect(await screen.findByText(/Портрет собран по прежним правилам/)).toBeTruthy();
    expect(screen.getByTestId('md').textContent).toContain('Обращение на «ты»');
  });

  it('свежий портрет — строки нет', async () => {
    mockProfile.isPortraitStale.mockResolvedValue(false);

    render(<AuthorPortrait readOnly />);

    await screen.findByTestId('md');
    expect(screen.queryByText(/Портрет собран по прежним правилам/)).toBeNull();
  });

  it('при открытии — ни одного вызова ИИ и ни одной пересборки портрета', async () => {
    render(<AuthorPortrait readOnly />);

    await screen.findByText(/Портрет собран по прежним правилам/);
    expect(mockProfile.generate).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('портрета нет — строки про прежние правила нет (нечего и обновлять)', async () => {
    mockProfile.getPortrait.mockResolvedValue(null);

    render(<AuthorPortrait readOnly />);

    await screen.findByText(/Портрет ещё не создан|Портрет появится/i);
    expect(screen.queryByText(/Портрет собран по прежним правилам/)).toBeNull();
    expect(mockProfile.generate).not.toHaveBeenCalled();
  });
});
