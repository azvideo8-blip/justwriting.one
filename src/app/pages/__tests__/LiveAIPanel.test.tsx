// R3-020: мобильная ИИ-панель получала пустой текст, и все действия были
// навсегда выключены. Панель берёт текст заметки из редактора.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveAIPanel } from '../LiveAIPanel';
import { useContentStore } from '../../../features/writing/store/useContentStore';

vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../core/auth', () => ({ getCurrentUser: () => null }));

describe('LiveAIPanel', () => {
  it('действия включены, когда в редакторе есть текст', () => {
    useContentStore.getState().setContent('Текст заметки для разбора');
    render(<LiveAIPanel open onClose={() => {}} />);
    expect(screen.getByText('ai_action_summarize').closest('button')).not.toBeDisabled();
  });
});
