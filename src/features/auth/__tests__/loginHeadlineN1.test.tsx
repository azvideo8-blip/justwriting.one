// N-1 (SA-20): разметка входа, на которой держится и десктоп, и телефон.
// Один заголовок, в нём «justwriting» и «.ru» раздельно — иначе на 360 px
// сорокавосьмикратный «justwriting.ru» резался до «justwriting.r», а на телефоне
// нужен 32 px с маленькой подписью домена. Десктоп обязан остаться прежним:
// текст заголовка и метки те же, свечение/вторая подпись под формой не возвращены.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginPage } from '../pages/LoginPage';

vi.mock('../services/AuthService', () => ({
  AuthService: {
    sendPasswordReset: vi.fn(),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
  },
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'ru', setLanguage: vi.fn() }),
}));
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../core/auth', () => ({ onAuthStateChange: () => () => {}, getCurrentUser: () => null }));
vi.mock('../../../core/crypto/encrypt', () => ({ clearSessionKey: vi.fn() }));
vi.mock('../../../core/crypto/cryptoHelpers', () => ({ setEncryptionEnabled: vi.fn() }));
vi.mock('../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ user: null, isGuest: true }) }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, useLocation: () => ({ search: '', state: null, pathname: '/login' }) };
});

function renderLogin() {
  return render(<LoginPage />);
}

describe('N-1 · заголовок входа', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('один заголовок с полным текстом «justwriting.ru»', () => {
    renderLogin();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('justwriting.ru');
  });

  it('домен — отдельный элемент внутри заголовка: его можно уменьшить на телефоне, не трогая слово', () => {
    renderLogin();
    const domain = screen.getByRole('heading', { level: 1 }).querySelector('span');
    expect(domain, '«justwriting» и «.ru» склеены в один текст: на 360 px снова обрежется').not.toBeNull();
    expect(domain!.textContent).toBe('.ru');
  });

  it('подзаголовок один, вторая подпись под формой не вернулась', () => {
    renderLogin();
    expect(screen.getAllByText('auth_subtitle')).toHaveLength(1);
    expect(screen.queryByText('auth_tagline')).toBeNull();
  });
});
