// R7Q-027 = R7F-022: «назад» оставляет мёртвые записи истории.
//
// Читалка заметки кладёт свою запись, лист «⋯» — свою. «Продолжить писать»
// идёт в редактор navigate() ДО onClose(), поэтому запись роутера ложится
// ПОВЕРХ обеих: ни одна из них не снимается, и после входа в редактор человек
// жмёт «назад» дважды впустую, прежде чем приложение отзовётся. Тот же класс
// дефекта во втором кейсе: две панели, закрываемые одним действием, делят один
// слот pendingBack — вторая запись не снимается никогда.
//
// Правка: перед навигацией записи панелей снимаются history.go(-глубина), и
// только потом кладётся запись роутера — вытесненные forward-записи браузер
// выбрасывает сам при push.
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import * as panelHistoryModule from '../usePanelHistory';
import { usePanelHistory } from '../usePanelHistory';

type CloseForNavigation = (run: () => void) => void;

// На базе хелпера нет — тогда воспроизводится прежний порядок действий:
// навигация сразу, панели закрываются в этом же обработчике.
const closeForNavigation: CloseForNavigation =
  (panelHistoryModule as { closePanelsForNavigation?: CloseForNavigation }).closePanelsForNavigation
  ?? ((run) => { run(); });

// Подписи кнопок вынесены из JSX: тестовая оболочка — не интерфейс, и в
// проверку «нет кириллицы в JSX» она попадать не должна.
const OPEN_CAPTION = 'открыть ⋯';
const CONTINUE_CAPTION = 'продолжить писать';
const CLOSE_BOTH_CAPTION = 'закрыть обе';

function Panel({ name, onClose }: { name: string; onClose: () => void }) {
  usePanelHistory(true, onClose, true);
  return <div role="dialog" aria-label={name} />;
}

function ArchiveScreen() {
  const navigate = useNavigate();
  const [reader, setReader] = useState(true);
  const [sheet, setSheet] = useState(false);
  return (
    <div>
      <span>archive</span>
      {reader && <Panel name="читалка" onClose={() => setReader(false)} />}
      {sheet && <Panel name="лист" onClose={() => setSheet(false)} />}
      <button type="button" onClick={() => setSheet(true)}>{OPEN_CAPTION}</button>
      <button
        type="button"
        onClick={() => {
          closeForNavigation(() => { void navigate('/write', { state: { sessionToContinue: 'x' } }); });
          setSheet(false);
          setReader(false);
        }}
      >
        {CONTINUE_CAPTION}
      </button>
    </div>
  );
}

function EditorScreen() {
  return <span>editor</span>;
}

// Настоящий BrowserRouter над jsdom-адресом: запись роутера — это настоящий
// pushState, и «мёртвые записи» меряются длиной истории, а не догадками.
function App(): ReactNode {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/archive" element={<ArchiveScreen />} />
        <Route path="/write" element={<EditorScreen />} />
      </Routes>
    </BrowserRouter>
  );
}

const flush = () => act(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 60));
});

beforeEach(() => {
  window.history.replaceState({ jwInitial: true }, '', '/archive');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('R7Q-027: выход из читалки в редактор не оставляет мёртвых записей', () => {
  it('после «Продолжить писать» «назад» ведёт в архив с первого нажатия', async () => {
    const start = window.history.length;
    render(<App />);
    await flush();
    expect(window.history.length - start, 'читалка не кладёт свою запись').toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'открыть ⋯' }));
    await flush();
    expect(window.history.length - start, 'лист «⋯» не кладёт свою запись').toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'продолжить писать' }));
    await flush();
    await flush();

    expect(screen.getByText('editor'), 'в редактор не вошли').toBeInTheDocument();
    expect(window.history.length - start, 'мёртвые записи читалки и листа остались в истории').toBe(1);

    act(() => { window.history.back(); });
    await flush();
    expect(screen.getByText('archive'), 'одно нажатие «назад» не вернуло в архив').toBeInTheDocument();
  });

  it('текущая запись не остаётся панелью, когда навигация уже в редакторе', async () => {
    const start = window.history.length;
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'открыть ⋯' }));
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'продолжить писать' }));
    await flush();
    await flush();

    const state = window.history.state as { jwPanel?: string; idx?: number } | null;
    expect(state?.jwPanel, 'под курсором лежит запись закрытой панели').toBeUndefined();
    expect(window.history.length - start).toBe(1);
  });

  it('две панели, закрытые одним действием, освобождают обе записи', async () => {    const start = window.history.length;
    function Harness() {
      const [a, setA] = useState(true);
      const [b, setB] = useState(true);
      return (
        <div>
          {a && <Panel name="A" onClose={() => setA(false)} />}
          {b && <Panel name="B" onClose={() => setB(false)} />}
          <button type="button" onClick={() => { setA(false); setB(false); }}>{CLOSE_BOTH_CAPTION}</button>
        </div>
      );
    }
    render(<Harness />);
    await flush();
    expect(window.history.length - start, 'две панели не кладут две записи').toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'закрыть обе' }));
    await flush();
    await flush();

    const state = window.history.state as { jwPanel?: string } | null;
    expect(state?.jwPanel, 'после закрытия двух панелей под курсором осталась мёртвая запись').toBeUndefined();
  });
});

// Проводка. Два верхних кейса проверяют сам хук на живом роутере; что
// «Продолжить писать» в архиве идёт ЧЕРЕЗ него — факт о вызывающем коде, и
// измеряется он по исходнику страницы (тот же приём, что F5 в
// finishModalNoDeadAnimation.n3). Прежний порядок `navigate()` до `onClose()`
// краснит этот храповик.
describe('R7Q-027: архив отпускает записи панелей перед переходом', () => {
  // Ревью приёмки 0.10.0: та же читалка с «⋯» открывается и со страницы ИИ —
  // правка легла только в архив.
  it.each(['src/app/pages/ArchivePage.tsx', 'src/app/pages/AIPage.tsx'])('%s: onContinue обёрнут в closePanelsForNavigation', (file) => {
    const page = readFileSync(file, 'utf8');
    expect(page, 'closePanelsForNavigation не импортирован в страницу архива').toContain('closePanelsForNavigation');
    const handler = page.match(/onContinue=\{[^}]*\}/g) ?? [];
    expect(handler.length, 'у превью заметок нет onContinue').toBeGreaterThan(0);
    for (const h of handler) {
      expect(h, `«Продолжить писать» идёт мимо снятия записей панелей: ${h}`).toContain('closePanelsForNavigation');
    }
  });
});
