// MF-5: один лист перед записью на телефоне — куда уходит голос и сколько это
// стоит, с «Больше не показывать» (по человеку). С сейфом — каждый раз и без
// галочки. Старт записи — прямо из нажатия «Записать».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, renderHook } from '@testing-library/react';
import { MobileWriteToolbar } from '../MobileWriteToolbar';
import { useTimerStore } from '../../store/useTimerStore';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

const d = vi.hoisted(() => ({ vault: false, cost: 30 as number | null, uid: 'u_a', startAfterNotice: vi.fn(), toggle: vi.fn() }));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k), tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: d.uid }) }));
vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => ({
    isListening: false, phase: 'idle', toggle: d.toggle, startAfterNotice: d.startAfterNotice,
    hasSupport: true, isVaultActive: d.vault, aiNoticeRemaining: null,
  }),
  previewDictationCost: () => Promise.resolve(d.cost),
}));

async function tapMic() {
  fireEvent.click(screen.getByRole('button', { name: /voice_start|voice_/ }));
  await act(async () => { await Promise.resolve(); });
}

describe('MF-5: voice notice sheet before recording (mobile)', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    Object.assign(d, { vault: false, cost: 30, uid: 'u_a' });
    d.startAfterNotice.mockClear();
    useTimerStore.setState({ status: 'idle' } as Partial<ReturnType<typeof useTimerStore.getState>>);
  });

  it('first tap → the sheet tells where the voice goes and what it costs; «Отмена» records nothing and sets no flag', async () => {
    render(<MobileWriteToolbar onStop={vi.fn()} />);
    await tapMic();
    expect(await screen.findByText('voice_sheet_where_audio')).toBeInTheDocument();
    expect(screen.getByText('voice_sheet_where_text')).toBeInTheDocument();
    expect(screen.getByText(/voice_sheet_cost.*30/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common_cancel' }));
    expect(d.startAfterNotice).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2)).toBeNull();
    expect(screen.queryByText('voice_sheet_where_audio')).toBeNull();
  });

  it('«Записать» starts recording from the tap; without the tick the sheet shows again next time', async () => {
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2, '1');
    render(<MobileWriteToolbar onStop={vi.fn()} />);
    await tapMic();
    fireEvent.click(await screen.findByRole('button', { name: 'voice_sheet_record' }));
    expect(d.startAfterNotice).toHaveBeenCalledTimes(1);
    await tapMic();
    expect(await screen.findByText('voice_sheet_where_audio')).toBeInTheDocument();
  });

  it('ticked «Больше не показывать» → the next tap records at once; another user still sees the sheet', async () => {
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2, '1');
    render(<MobileWriteToolbar onStop={vi.fn()} />);
    await tapMic();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'voice_sheet_dont_show' }));
    fireEvent.click(screen.getByRole('button', { name: 'voice_sheet_record' }));
    expect(localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_DISMISSED('u_a'))).toBe('1');
    await tapMic();
    expect(d.startAfterNotice).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('voice_sheet_where_audio')).toBeNull();

    d.uid = 'u_b';
    await tapMic();
    expect(await screen.findByText('voice_sheet_where_audio')).toBeInTheDocument();
  });

  it('the very first recording shows the sheet even if this user dismissed it (privacy part seen once)', async () => {
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_DISMISSED('u_a'), '1');
    render(<MobileWriteToolbar onStop={vi.fn()} />);
    await tapMic();
    expect(await screen.findByText('voice_sheet_where_audio')).toBeInTheDocument();
  });

  it('vault on → the sheet every time, vault text, no checkbox, even after dismissal', async () => {
    d.vault = true;
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2, '1');
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_DISMISSED('u_a'), '1');
    render(<MobileWriteToolbar onStop={vi.fn()} />);
    await tapMic();
    expect(await screen.findByText('voice_confirm_vault_desc')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(d.startAfterNotice).not.toHaveBeenCalled();
  });

  it('no AI on this recording → no cost line', async () => {
    d.cost = null;
    render(<MobileWriteToolbar onStop={vi.fn()} />);
    await tapMic();
    expect(await screen.findByText('voice_sheet_where_audio')).toBeInTheDocument();
    expect(screen.queryByText(/voice_sheet_cost/)).toBeNull();
  });
});

describe('MF-5: «Записать» path in useGuardedSpeechInput', () => {
  it('noticeHandled → V2 set and startListening called synchronously, no confirm', async () => {
    vi.resetModules();
    const startListening = vi.fn();
    const confirm = vi.fn();
    vi.doMock('../../../../shared/hooks/useSpeechInput', () => ({
      useSpeechInput: () => ({ isListening: false, liveText: '', interimText: '', startListening, stopListening: vi.fn(), cancel: vi.fn(), hasSupport: true }),
    }));
    vi.doMock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm }) }));
    vi.doMock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ user: { uid: 'u_a' } }) }));
    localStorage.clear();
    const { useGuardedSpeechInput } = await import('../../hooks/useGuardedSpeechInput');
    const { result } = renderHook(() => useGuardedSpeechInput({ onSessionEnd: vi.fn() }));
    void result.current.toggleListening({ noticeHandled: true });
    expect(startListening).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2)).toBe('1');
  });
});
