// TR-2: знакомство — карточка-окно и кольцо вокруг цели.
// Мутации (прогнаны, каждая красная):
//  1. писать `done` при закрытии из-за чужого окна → «чужое окно → тур исчез, отметки нет»;
//  2. убрать возврат фокуса в finish → «Esc → skipped, фокус вернулся»;
//  3. убрать ожидание цели (`!main && waited < TARGET_WAIT_MS`) → «цели нет 3 с» и «цель через 500 мс»;
//  4. поменять местами тексты с согласием и без → «без согласия на ИИ», «профиль не прочитан»;
//  5. убрать blur поля текста при старте → «фокус из поля текста снят»;
//  6. убрать `arrived`-ветку (уход со страницы) → «ушли со страницы шага».
import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { renderWithProviders } from '../../../test/utils/render';
import { TourOverlay } from '../TourOverlay';
import { useAiConsentStore } from '../../../core/ai/aiConsent';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';

let layoutMode: 'desktop' | 'mobile' = 'desktop';
let reduced = false;
vi.mock('../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return { ...actual, useReducedMotion: () => reduced };
});
vi.mock('../../../core/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/auth')>();
  return { ...actual, getCurrentUser: () => ({ uid: 'u-tour' }) };
});

const paths: string[] = [];
const nav: { go: (to: string) => void } = { go: () => {} };
const goTo = (to: string) => nav.go(to);
function Probe() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => { nav.go = to => { void navigate(to); }; }, [navigate]);
  useEffect(() => { if (paths[paths.length - 1] !== pathname) paths.push(pathname); }, [pathname]);
  return null;
}

function addTarget(name: string, tag = 'div') {
  const el = document.createElement(tag);
  el.setAttribute('data-tour', name);
  el.getBoundingClientRect = () => ({ top: 100, left: 100, right: 300, bottom: 160, width: 200, height: 60, x: 100, y: 100, toJSON: () => ({}) });
  document.body.appendChild(el);
  return el;
}

const onClose = vi.fn();
function renderTour(opts: { uid?: string | null; isGuest?: boolean; start?: string } = {}) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[opts.start ?? '/']}>
      <Probe />
      <TourOverlay uid={opts.uid === undefined ? 'u-tour' : opts.uid} isGuest={opts.isGuest ?? false} onClose={onClose} />
    </MemoryRouter>,
  );
}
const tick = (ms = 200) => act(() => { vi.advanceTimersByTime(ms); });
const mark = () => localStorage.getItem('jw_tour_v1_u-tour');
const card = () => document.querySelector<HTMLElement>('[data-tour-card]');
const ring = () => document.querySelector('[data-testid="tour-ring"]');
const click = (name: string) => { fireEvent.click(screen.getByRole('button', { name })); };

describe('TR-2: TourOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    layoutMode = 'desktop';
    reduced = false;
    paths.length = 0;
    onClose.mockClear();
    localStorage.clear();
    useEncryptionStore.setState({ profileLoaded: { 'u-tour': true } });
    useAiConsentStore.setState({ consents: { 'u-tour': true } });
    for (const n of ['editor', 'mic', 'notes-list', 'tab-archive', 'persona']) addTarget(n);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('«Дальше» до конца → done; маршруты /, /archive, /ai; счётчик и заголовки называют место', () => {
    renderTour();
    tick();
    expect(card()).toHaveAttribute('role', 'dialog');
    expect(card()).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('dialog', { name: '«Писать» — здесь ты пишешь' })).toBe(card());
    expect(card()).toHaveTextContent('1 из 3');
    expect(ring()).not.toBeNull();
    expect(document.querySelector('[data-testid="tour-ring-second"]')).not.toBeNull();
    click('Дальше');
    tick();
    expect(screen.getByRole('dialog', { name: '«Заметки» — здесь будут твои записи' })).toBeInTheDocument();
    expect(card()).toHaveTextContent('2 из 3');
    click('Дальше');
    tick();
    expect(screen.getByRole('dialog', { name: '«ИИ» — здесь разговор с собеседником' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Пропустить' })).toBeNull();
    expect(mark()).toBeNull();
    click('Готово');
    expect(mark()).toBe('done');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(paths).toEqual(['/', '/archive', '/ai']);
  });

  it('«Назад» возвращает на прошлый шаг и экран', () => {
    renderTour();
    tick();
    click('Дальше');
    tick();
    click('Назад');
    tick();
    expect(card()).toHaveTextContent('1 из 3');
    expect(paths).toEqual(['/', '/archive', '/']);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('«Пропустить» на втором шаге → skipped:2', () => {
    renderTour();
    tick();
    click('Дальше');
    tick();
    click('Пропустить');
    expect(mark()).toBe('skipped:2');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc → skipped:<шаг>, фокус вернулся туда, где был до старта', () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    renderTour();
    tick();
    expect(document.activeElement).toBe(card());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mark()).toBe('skipped:1');
    expect(document.activeElement).toBe(before);
  });

  // Ревью 0.11.14: Esc, пока карточки ещё нет (цель грузится), не ставит «пропущено»
  // за тур, которого человек не видел. Мутация: useModalEscape(true, …) → красный.
  it('Esc до появления карточки → отметки нет, тур не закрыт', () => {
    renderTour();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mark()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('фокус из поля текста снят при старте и в поле не возвращается на телефоне', () => {
    layoutMode = 'mobile';
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    field.focus();
    renderTour();
    expect(document.activeElement).not.toBe(field);
    tick();
    expect(document.activeElement).toBe(card());
    click('Пропустить');
    expect(document.activeElement).not.toBe(field);
  });

  it('Tab ходит по кнопкам карточки по кругу', () => {
    renderTour();
    tick();
    click('Дальше');
    tick();
    const buttons = Array.from(card()!.querySelectorAll('button'));
    expect(buttons.map(b => b.textContent)).toEqual(['Пропустить', 'Назад', 'Дальше']);
    buttons[2]!.focus();
    fireEvent.keyDown(buttons[2]!, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0]!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(buttons[2]);
    card()!.focus();
    fireEvent.keyDown(card()!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(buttons[2]);
  });

  it('кнопки карточки — не меньше 44 px (min-h-11)', () => {
    renderTour();
    tick();
    click('Дальше');
    tick();
    for (const b of card()!.querySelectorAll('button')) expect(b.className).toMatch(/\bmin-h-11\b/);
  });

  it('цели нет 3 с → карточка по центру без кольца; раньше — карточки нет', () => {
    document.querySelector('[data-tour="editor"]')!.remove();
    renderTour();
    tick(2800);
    expect(card()).toBeNull();
    expect(document.querySelector('[data-testid="tour-backdrop"]')).not.toBeNull();
    tick(200);
    expect(card()).not.toBeNull();
    expect(ring()).toBeNull();
    expect(card()).toHaveTextContent('1 из 3');
  });

  it('цель появилась через 500 мс → кольцо есть', () => {
    document.querySelector('[data-tour="editor"]')!.remove();
    renderTour();
    tick(400);
    expect(card()).toBeNull();
    addTarget('editor');
    tick(200);
    expect(card()).not.toBeNull();
    expect(ring()).not.toBeNull();
  });

  it('чужое окно → тур исчез, отметки нет', () => {
    renderTour();
    tick();
    const foreign = document.createElement('div');
    foreign.setAttribute('role', 'dialog');
    document.body.appendChild(foreign);
    tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mark()).toBeNull();
  });

  it('степпер первого входа → тур исчез, отметки нет', () => {
    renderTour();
    tick();
    const stepper = document.createElement('div');
    stepper.setAttribute('data-testid', 'first-run-stepper');
    document.body.appendChild(stepper);
    tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mark()).toBeNull();
  });

  it('ушли со страницы шага не кнопками тура → тур закрыт, отметки нет', () => {
    renderTour();
    tick();
    act(() => goTo('/profile'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mark()).toBeNull();
  });

  it('ручной запуск с другой страницы начинает с «Писать»', () => {
    renderTour({ start: '/profile' });
    tick();
    expect(paths).toEqual(['/profile', '/']);
    expect(card()).toHaveTextContent('1 из 3');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('без микрофона шаг 1 — без фразы про микрофон', () => {
    document.querySelector('[data-tour="mic"]')!.remove();
    renderTour();
    tick();
    expect(card()).toHaveTextContent('Просто начни — черновик сохраняется сам.');
    expect(card()).not.toHaveTextContent('микрофон');
    expect(document.querySelector('[data-testid="tour-ring-second"]')).toBeNull();
  });

  it('с микрофоном шаг 1 говорит про микрофон', () => {
    renderTour();
    tick();
    expect(card()).toHaveTextContent('нажми на микрофон и говори');
  });

  const toAiStep = () => { tick(); click('Дальше'); tick(); click('Дальше'); tick(); };

  it('без согласия на ИИ → на шаге 3 «ИИ выключен»', () => {
    useAiConsentStore.setState({ consents: { 'u-tour': false } });
    renderTour();
    toAiStep();
    expect(card()).toHaveTextContent('Сейчас ИИ выключен');
  });

  it('согласие есть → обычный текст шага 3', () => {
    renderTour();
    toAiStep();
    expect(card()).toHaveTextContent('Он опирается на разобранные заметки и на те, что приложены к разговору.');
    expect(card()).not.toHaveTextContent('ИИ выключен');
  });

  it('профиль не прочитан → обычный текст, не «выключен»', () => {
    useEncryptionStore.setState({ profileLoaded: {} });
    useAiConsentStore.setState({ consents: {} });
    renderTour();
    toAiStep();
    expect(card()).not.toHaveTextContent('ИИ выключен');
  });

  it('«меньше движения» → у кольца нет перехода; обычно — есть', () => {
    reduced = true;
    renderTour();
    tick();
    expect(ring()!.className).not.toMatch(/transition|duration/);
    expect(card()!.className).not.toMatch(/transition|duration|animate/);
    cleanup();
    reduced = false;
    renderTour();
    tick();
    expect(ring()!.className).toMatch(/transition/);
  });

  it('гость → два шага, счётчик «из 2», отметка не пишется', () => {
    renderTour({ uid: null, isGuest: true });
    tick();
    expect(card()).toHaveTextContent('1 из 2');
    click('Дальше');
    tick();
    expect(card()).toHaveTextContent('2 из 2');
    click('Готово');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(paths).toEqual(['/', '/archive']);
    expect(localStorage.length).toBe(0);
  });

  it('на телефоне шаг 2 показывает вкладку, на компьютере — список', () => {
    document.querySelector('[data-tour="notes-list"]')!.remove();
    layoutMode = 'mobile';
    renderTour();
    tick();
    click('Дальше');
    tick();
    expect(ring()).not.toBeNull();
    cleanup();
    paths.length = 0;
    layoutMode = 'desktop';
    renderTour();
    tick();
    click('Дальше');
    tick(400);
    expect(ring()).toBeNull();
  });
});
