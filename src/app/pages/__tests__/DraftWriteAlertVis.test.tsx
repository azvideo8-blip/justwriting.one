// VIS (утверждено владельцем 04.11): показ на десктопе — эталон, телефон
// подтягивается к нему (VIS-3).
//
// T3, строка 6 карты: «Значок и существующие слова — сразу». Слова ошибки
// (`editor_error_save` / `editor_error_quota`) жили в подсказке по наведению
// (`SaveStatus.tsx:147`): человек, который не наводит, значок не расшифрует и
// закроет вкладку с текстом, которого нет ни в одном адресе.
//
// T3, баннер: новое состояние показывается одним баннером над редактором,
// Новый компонент (`DraftWriteAlertBar`) — без него
// нельзя: состояния ставят писатели (`useDraftCore`, `useDraftAutosave`), а
// показывает одна строка в двух раскладках; через контекст сессии она тащилась
// бы через четыре возвращаемых типа (причина — в отчёте, VIS-3).
//
// Мутации: вернуть подсказке ошибки `opacity-0` — кейсы 1 и 2 красные;
// снять баннер с раскладки — кейсы 4-7 красные; поменять приоритет
// (`localWriteStuck ? … : …`) — кейс 6 красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DesktopWritingLayout } from '../DesktopWritingLayout';
import { ToastProvider } from '../../../shared/components/Toast';
import { LanguageProvider } from '../../../shared/i18n';
import { useContentStore } from '../../../features/writing/store/useContentStore';
import { useDraftWriteAlertStore } from '../../../features/writing/store/useDraftWriteAlertStore';

const state = vi.hoisted(() => ({
  saveStatus: 'idle' as 'idle' | 'saving' | 'saved' | 'cloud-stale' | 'error',
  saveErrorKind: null as 'quota' | 'unknown' | 'cloud-too-large' | 'cloud-refused' | 'cloud-off' | null,
  isZenActive: false,
}));

vi.mock('../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    editorWidth: 68,
    zenSeenOnce: true,
    isZenActive: state.isZenActive,
    zenModeEnabled: true,
    lifeLogEnabled: true,
    lifeLogVisible: false,
    lifeLogPinned: false,
    lifeLogTab: 'log',
    setLifeLogVisible: vi.fn(),
    setLifeLogTab: vi.fn(),
    setLifeLogPinned: vi.fn(),
  }),
}));

vi.mock('../../../features/writing/contexts/WritingSessionContext', () => ({
  useWritingSessionContext: () => ({
    flow: {
      setupMode: false,
      setSetupMode: vi.fn(),
      startCountdown: vi.fn(),
      countdown: null,
      totalDurationForDeadline: null,
      sessionStartFlash: false,
    },
    actions: {
      handleNew: vi.fn(),
      handleOpen: vi.fn(),
      handlePlay: vi.fn(),
      handlePause: vi.fn(),
      handleContinueDocument: vi.fn(),
      handleContinueSessionOrDoc: vi.fn(),
    },
    session: {
      status: 'writing',
      hasDraft: false,
      userId: 'u1',
      saveStatus: state.saveStatus,
      saveErrorKind: state.saveErrorKind,
      setTitle: vi.fn(),
      restoreDraft: vi.fn(),
      discardDraft: vi.fn(),
    },
    streakDays: 1,
    handlePlayRef: { current: vi.fn() },
    keystrokeTrackerRef: { current: { record: vi.fn() } },
    showZen: state.isZenActive,
    onFinishClick: vi.fn(),
  }),
}));

vi.mock('../../../features/writing/components/WritingHeader', () => ({ WritingHeader: () => null }));
vi.mock('../../../features/writing/components/WritingEditor', () => ({ WritingEditor: () => null }));
vi.mock('../../../features/writing/components/WritingSetup', () => ({ WritingSetup: () => null }));
vi.mock('../../../features/writing/components/LifeLogPanel', () => ({ LifeLogPanel: () => null }));
// Дискета живёт в панели кнопок: мок панели рисует только её, из тех же пропсов.
vi.mock('../../../features/writing/components/BottomStats', async () => {
  const { SaveStatus } = await import('../../../features/writing/components/SaveStatus');
  return {
    BottomStats: (p: { saveStatus?: typeof state.saveStatus; saveErrorKind?: typeof state.saveErrorKind }) =>
      <SaveStatus saveStatus={p.saveStatus ?? 'idle'} saveErrorKind={p.saveErrorKind ?? null} />,
  };
});
vi.mock('../../../features/writing/components/SessionGlow', () => ({ SessionGlow: () => null }));

// Тексты дословные из решения владельца 04.11 (тикет, строки 41 и 43).
const T3_RU = 'Текст только на экране. Не закрывай вкладку.';

const renderLayout = () => render(
  <LanguageProvider>
    <ToastProvider><DesktopWritingLayout /></ToastProvider>
  </LanguageProvider>
);

beforeEach(() => {
  state.saveStatus = 'idle';
  state.saveErrorKind = null;
  state.isZenActive = false;
  useDraftWriteAlertStore.setState({ localWriteStuck: false });
  useContentStore.setState({ content: '', title: '', wordCount: 0 });
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class Stub { observe() {} unobserve() {} disconnect() {} }
    globalThis.ResizeObserver = Stub as unknown as typeof ResizeObserver;
  }
});

describe('VIS T3: слова ошибки на десктопе видны сразу', () => {
  // `className` строкой проверять нельзя: `group-hover:opacity-100` содержит
  // `opacity-100`, и подсказка, которая видна только по наведению, прошла бы как
  // постоянная (урок приёмки DW-6: тест закрепил неверный ответ как верный).
  const visibleNow = (el: HTMLElement) => el.classList.contains('opacity-100') && !el.classList.contains('opacity-0');

  it('ошибка записи: существующие слова без наведения', () => {
    state.saveStatus = 'error';
    renderLayout();
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Ошибка сохранения');
    expect(visibleNow(tip), 'слова ошибки спрятаны до наведения').toBe(true);
  });

  it('нехватка места: те же существующие слова, сразу', () => {
    state.saveStatus = 'error';
    state.saveErrorKind = 'quota';
    renderLayout();
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Недостаточно места на устройстве');
    expect(visibleNow(tip), 'слова о нехватке места спрятаны до наведения').toBe(true);
  });

  it('контроль: прочие статусы подсказкой по наведению, как раньше', () => {
    state.saveStatus = 'saved';
    renderLayout();
    const tip = screen.getByRole('tooltip');
    expect(visibleNow(tip), 'подсказка обычного сохранения стала постоянной').toBe(false);
    expect(tip.classList.contains('group-hover:opacity-100'), 'подсказка потеряла наведение').toBe(true);
  });
});

describe('VIS T3: баннер над редактором', () => {

  it('T3: локальная запись отказала подряд — утверждённый текст', () => {
    useDraftWriteAlertStore.setState({ localWriteStuck: true });
    renderLayout();
    expect(screen.getByTestId('draft-alert-local-write-stuck')).toHaveTextContent(T3_RU);
  });

  it('нет состояния — нет баннера (колонка не сдвинута)', () => {
    renderLayout();
    expect(screen.queryByTestId('draft-alert-local-write-stuck')).toBeNull();
    expect(screen.queryByTestId('draft-alert-local-write-stuck')).toBeNull();
  });

  it('I3: в баннере нет ни текста заметки, ни адреса аккаунта', () => {
    useContentStore.setState({ content: 'секретный текст VIS', title: 'заголовок VIS', wordCount: 3 });
    useDraftWriteAlertStore.setState({ localWriteStuck: true });
    renderLayout();
    const text = screen.getByTestId('draft-alert-local-write-stuck').textContent ?? '';
    expect(text, 'в показе текст заметки').not.toContain('секретный текст VIS');
    expect(text, 'в показе заголовок заметки').not.toContain('заголовок VIS');
    expect(text, 'в показе адрес аккаунта').not.toContain('u1');
  });
});
