import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, render, act } from '@testing-library/react';
import { usePanelHistory } from '../usePanelHistory';

let mobile = true;
vi.mock('../useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: mobile ? 'mobile' : 'desktop', setLayoutMode: vi.fn() }),
}));

// MB-9: «назад» закрывает открытую панель (лист, модалку, настройки), а не уводит
// из приложения. В jsdom нет настоящей навигации назад, поэтому popstate
// воспроизводится событием с прежним состоянием — ровно так, как его присылает
// браузер после history.back().

function popTo(state: unknown): void {
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', { state }));
  });
}

describe('MB-9: usePanelHistory', () => {
  beforeEach(() => {
    history.replaceState({ jwInitial: true }, '');
  });
  afterEach(() => {
    history.replaceState(null, '');
  });

  it('открытие кладёт свою запись, закрытие кнопкой снимает её', async () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const onClose = vi.fn();
    const { rerender } = renderHook(
      ({ open }) => usePanelHistory(open, onClose, true),
      { initialProps: { open: false } },
    );

    act(() => rerender({ open: true }));
    const pushed = (history.state as { jwPanel?: string }).jwPanel;
    expect(pushed, 'открытие не кладёт запись в историю').toBeTruthy();

    act(() => rerender({ open: false }));
    // MF-11: снятие записи откладывается на такт — вдруг её заберёт следующая панель.
    await act(() => new Promise<void>(r => setTimeout(r, 10)));
    expect(back, 'закрытие кнопкой не снимает свою запись').toHaveBeenCalledTimes(1);
    expect(onClose, 'закрытие самим компонентом не должен звать onClose повторно').not.toHaveBeenCalled();
    back.mockRestore();
  });

  it('popstate закрывает панель и не идёт назад второй раз', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const onClose = vi.fn();
    renderHook(() => usePanelHistory(true, onClose, true));
    act(() => {
      // Браузер вернулся на прежнюю запись: в ней нет нашего jwPanel.
      popTo({ jwInitial: true });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    // После закрытия очистка не должна вызывать history.back() — запись уже снята.
    back.mockRestore();
  });

  it('вложенность: «назад» снимает только верхнюю панель', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    const { rerender } = renderHook(
      ({ openOuter, openInner }) => {
        usePanelHistory(openOuter, closeOuter, true);
        usePanelHistory(openInner, closeInner, true);
      },
      { initialProps: { openOuter: true, openInner: false } },
    );
    // Под записью листа лежит запись самого листа: «назад» из вложенной панели
    // обязан вернуть именно её, а не произвольную строку.
    const outerId = (history.state as { jwPanel?: string }).jwPanel;
    expect(outerId, 'внешний лист не кладёт запись').toBeTruthy();

    act(() => rerender({ openOuter: true, openInner: true }));
    const innerId = (history.state as { jwPanel?: string }).jwPanel;
    expect(innerId, 'вложенная панель не кладёт свою запись').toBeTruthy();
    expect(innerId).not.toBe(outerId);

    // «Назад» с верхней записи — закрылась только внутренняя.
    act(() => popTo({ jwPanel: outerId }));
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter, 'верхний лист закрылся вместе с внутренним').not.toHaveBeenCalled();
    back.mockRestore();
  });

  it('на десктопе (enabled=false) история не трогается', () => {
    const before = window.history.length;
    const onClose = vi.fn();
    renderHook(() => usePanelHistory(true, onClose, false));
    expect(window.history.state?.jwPanel ?? null, 'десктопная панель положила запись в историю').toBeNull();
    act(() => popTo({ jwInitial: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(window.history.length).toBe(before);
  });
});

// Проверка на настоящем компоненте: лист/модалка сами по себе должны класть
// запись в историю. На базе (ModalShell без usePanelHistory) это красно.
describe('MB-9: ModalShell в мобильном макете кладёт запись в историю', () => {
  it('открытие листа пушит запись, закрытие по onClose её снимает', async () => {
    const { ModalShell } = await import('../../components/ModalShell');
    history.replaceState({ jwInitial: true }, '');
    const before = (history.state as { jwPanel?: string }).jwPanel ?? null;
    const onClose = vi.fn();
    const { rerender } = render(
      <ModalShell open labelId="x" onClose={onClose} variant="sheet"><span>sheet</span></ModalShell>,
    );
    const pushed = (history.state as { jwPanel?: string }).jwPanel ?? null;
    expect(pushed, 'ModalShell в мобильном макете не кладёт запись в историю').not.toBeNull();
    expect(pushed).not.toBe(before);
    act(() => rerender(<ModalShell open={false} labelId="x" onClose={onClose} variant="sheet"><span>sheet</span></ModalShell>));
    // history.back() в jsdom применяется асинхронно — ждём, пока состояние вернётся.
    await vi.waitFor(() => expect((history.state as { jwPanel?: string }).jwPanel ?? null,
      'закрытие не сняло свою запись').toBe(before));
  });

  it('десктопный макет: история не трогается', async () => {
    mobile = false;
    const { ModalShell } = await import('../../components/ModalShell');
    history.replaceState({ jwInitial: true }, '');
    render(<ModalShell open labelId="x" onClose={vi.fn()}><span>modal</span></ModalShell>);
    expect((history.state as { jwPanel?: string }).jwPanel ?? null, 'десктопная модалка положила запись в историю').toBeNull();
  });
});
