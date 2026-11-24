// Дейлик 19.11, подозрения 1, 4, 5 (превью заметки, десктоп):
// 1 — сбой чтения текста (_contentError) показывался как «Содержимое недоступно»
//     (как у пустой заметки), повторить чтение было нельзя;
// 4 — связанная заметка, которой нет на устройстве, не открывалась молча;
// 5 — отказ чтения разбора молчал: кнопка «Разобрать», будто разбора нет.
// Мутации: убрать ветку _contentError / тост «не открылась» / .catch у сводки — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import type { ArchiveSession } from '../../types';

const loadSessionContent = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/services/UnifiedSessionLoader', async (orig) => ({ ...(await orig<object>()), loadSessionContent }));
const dbGet = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/storage/localDb', async (orig) => ({ ...(await orig<object>()), getLocalDb: async () => ({ get: dbGet }) }));
vi.mock('../../../../core/auth', async (orig) => ({ ...(await orig<object>()), getCurrentUser: () => ({ uid: 'user-1' }) }));

import { DocumentPreview } from '../DocumentPreview';

const base: ArchiveSession = {
  id: 'doc-1', userId: 'user-1', title: 'Заметка', content: '', duration: 60, wordCount: 10, charCount: 0, wpm: 10, tags: [], createdAt: Date.now(), _isLocal: true,
};

function renderPreview(session: ArchiveSession, opts: { fetchSummary?: () => Promise<null>; related?: { documentId: string; title: string; date: string; score: number }[]; fetchRelated?: () => Promise<never> } = {}) {
  return renderWithProviders(
    <MemoryRouter>
      <ToastProvider>
        <DocumentPreview
          session={session} onClose={vi.fn()} onContinue={vi.fn()} onAnalyzeNote={vi.fn()}
          fetchSummary={opts.fetchSummary ?? (async () => null)}
          fetchRelatedNotes={opts.fetchRelated ?? (async () => (opts.related ?? []) as never)}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('превью: отказы чтения названы', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('1: текст не прочитался — не «Содержимое недоступно», есть «Повторить», повтор перечитывает', async () => {
    loadSessionContent.mockResolvedValue({ content: 'Текст на месте.', _contentNotLoaded: false });
    renderPreview({ ...base, _contentError: true });
    expect(await screen.findByText('Текст заметки не прочитался.')).toBeTruthy();
    expect(screen.queryByText('Содержимое недоступно')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Текст на месте.')).toBeTruthy();
    expect(loadSessionContent).toHaveBeenCalledWith('user-1', 'doc-1');
  });

  // Доделки 19.11. Мутации: убрать ветку `error` у копирования — окно копирования
  // открывается над непрочитанным текстом; убрать `_contentError` из exportRefusalKey —
  // отказ экспорта снова «зашифрована». Обе красят этот тест.
  it('текст не прочитался — копирование и экспорт отказывают словами про сбой чтения', async () => {
    renderPreview({ ...base, _contentError: true });
    await screen.findByRole('button', { name: 'Повторить' });
    fireEvent.click(screen.getByTitle('Скопировать как'));
    expect(await screen.findAllByText('Текст заметки не прочитался.')).toHaveLength(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTitle('Экспортировать'));
    fireEvent.click(await screen.findByText('Текстовый (.txt)'));
    expect(await screen.findAllByText('Текст заметки не прочитался.')).toHaveLength(3);
    expect(screen.queryByText('Заметка зашифрована или недоступна — экспортировать нечего.')).toBeNull();
  });

  it('5: разбор не прочитался — сказано, а не молча «Разобрать»', async () => {
    renderPreview({ ...base, content: 'Текст.' }, { fetchSummary: () => Promise.reject(new Error('IDB down')) });
    expect(await screen.findByText('Разбор не прочитался — облако не ответило.')).toBeTruthy();
    expect(screen.queryByText('Разобрать заметку через ИИ')).toBeNull();
  });

  it('4: связанной заметки нет на устройстве — тост, а не тишина', async () => {
    dbGet.mockResolvedValue(undefined);
    renderPreview({ ...base, id: 'doc-4', content: 'Текст.' }, { related: [{ documentId: 'doc-2', title: 'Связанная', date: '2026-11-01', score: 0.9 }] });
    fireEvent.click(await screen.findByText('Связанная'));
    expect(await screen.findByText('Не удалось загрузить данные.')).toBeTruthy();
  });

  // Дейлик 20.11 Н-5: подбор связанных сорвался — строка с «Повторить», а не
  // молча нет блока. Мутация: в catch не ставить relatedFailed — красный.
  it('связанные не подобрались — сказано, «Повторить» подбирает заново', async () => {
    const fetchRelated = vi.fn()
      .mockRejectedValueOnce(new Error('vectors down'))
      .mockResolvedValueOnce([{ documentId: 'doc-r', title: 'Связанная синтетика', date: '2026-11-01', score: 0.9 }]);
    renderPreview({ ...base, id: 'doc-rel', content: 'Текст.' }, { fetchRelated });
    expect(await screen.findByText(/Не прочиталось — попробуй ещё раз/)).toBeTruthy();
    const retry = screen.getAllByRole('button', { name: 'Повторить' }).at(-1)!;
    fireEvent.click(retry);
    expect(await screen.findByText('Связанная синтетика')).toBeTruthy();
    expect(fetchRelated).toHaveBeenCalledTimes(2);
  });

  // Дейлик 20.11: кэш связанных переживал удаление заметки. Мутация: убрать
  // подписку на события заметок — красный (второй подбор не случается).
  // Н-2 (дейлик 22.11): то же после восстановления из облака и импорта. Мутация: убрать
  // sync.restoredFromCloud из условия — красный.
  it.each([
    ['удаления заметки', { type: 'note.trashed', documentId: 'doc-x' }, 'doc-cache'],
    ['восстановления из облака', { type: 'sync.restoredFromCloud', userId: 'user-1' }, 'doc-cache-2'],
  ] as const)('после %s связанные подбираются заново, без события — из кэша', async (_name, event, id) => {
    const { emitDomainEvent } = await import('../../../../core/events/domainEvents');
    const fetchRelated = vi.fn(async () => [{ documentId: 'doc-x', title: 'Связь', date: '2026-11-01', score: 0.9 }] as never);
    const first = renderPreview({ ...base, id, content: 'Текст.' }, { fetchRelated });
    await screen.findByText('Связь');
    first.unmount();
    const again = renderPreview({ ...base, id, content: 'Текст.' }, { fetchRelated });
    await screen.findByText('Связь');
    expect(fetchRelated).toHaveBeenCalledTimes(1);
    again.unmount();
    emitDomainEvent(event);
    renderPreview({ ...base, id, content: 'Текст.' }, { fetchRelated });
    await waitFor(() => expect(fetchRelated).toHaveBeenCalledTimes(2));
  });

  // Ревью 0.11.23: строка сбоя связанных от прошлой заметки не висит над новой, пока
  // та подбирается. Мутация: не сбрасывать relatedFailed в начале эффекта — красный.
  it('другая заметка — строка сбоя прошлой снята, пока подбор новой идёт', async () => {
    const fail = { ...base, id: 'doc-fail', content: 'Текст.' };
    const next = { ...base, id: 'doc-next', content: 'Другой текст.' };
    function Switcher() {
      const [current, setCurrent] = useState<ArchiveSession>(fail);
      return (
        <>
          <button onClick={() => setCurrent(next)}>switch</button>
          <DocumentPreview
            session={current} onClose={vi.fn()} onContinue={vi.fn()} onAnalyzeNote={vi.fn()}
            fetchSummary={async () => null}
            fetchRelatedNotes={(id: string) => (id === 'doc-fail' ? Promise.reject(new Error('vectors down')) : new Promise<never>(() => {}))}
          />
        </>
      );
    }
    renderWithProviders(<MemoryRouter><ToastProvider><Switcher /></ToastProvider></MemoryRouter>);
    expect(await screen.findByText(/Не прочиталось — попробуй ещё раз/)).toBeTruthy();
    fireEvent.click(screen.getByText('switch'));
    await screen.findByText('Другой текст.');
    expect(screen.queryByText(/Не прочиталось — попробуй ещё раз/)).toBeNull();
  });

  // Ревью 0.11.24: разбор заметки A не остаётся под заметкой B, и отказ чтения
  // разбора B виден. Мутация: не сбрасывать summary в начале эффекта — красный.
  it('другая заметка — разбор прошлой снят, отказ чтения новой назван', async () => {
    const a = { ...base, id: 'doc-a', content: 'Текст A.' };
    const b = { ...base, id: 'doc-b', content: 'Текст B.' };
    function Switcher() {
      const [current, setCurrent] = useState<ArchiveSession>(a);
      return (
        <>
          <button onClick={() => setCurrent(b)}>switch</button>
          <DocumentPreview
            session={current} onClose={vi.fn()} onContinue={vi.fn()} onAnalyzeNote={vi.fn()}
            fetchSummary={(id: string) => (id === 'doc-a'
              ? Promise.resolve({ summary: 'synthetic summary A', themes: [], insights: [], extractedFacts: [] } as never)
              : Promise.reject(new Error('cloud down')))}
            fetchRelatedNotes={async () => [] as never}
          />
        </>
      );
    }
    renderWithProviders(<MemoryRouter><ToastProvider><Switcher /></ToastProvider></MemoryRouter>);
    // Блок разбора свёрнут — его заголовок и есть признак «разбор показан».
    expect(await screen.findByText('Что заметил ИИ')).toBeTruthy();
    fireEvent.click(screen.getByText('switch'));
    expect(await screen.findByText('Разбор не прочитался — облако не ответило.')).toBeTruthy();
    expect(screen.queryByText('Что заметил ИИ')).toBeNull();
  });
});
