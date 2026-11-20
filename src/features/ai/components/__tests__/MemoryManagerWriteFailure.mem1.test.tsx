// MEM-1 (дейлик 20.11): окно «Память ИИ» — строка уходит из списка только после ответа
// хранилища; сбой записи — строка на месте и тост ошибки (раньше строка исчезала до ответа
// и при сбое молча возвращалась). Настоящий AIChatMemoryService поверх fake-indexeddb;
// подменён только край — запись/удаление в IndexedDB отказывает по флагу.
// Мутация: убирать строку до await записи — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const showToast = vi.hoisted(() => vi.fn());
const failWrites = vi.hoisted(() => ({ on: false }));

vi.mock('@/shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'ru' }) }));
vi.mock('@/shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }) }));
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/core/storage/localDb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/storage/localDb')>();
  return {
    ...actual,
    getLocalDb: async (uid?: string) => {
      const db = await actual.getLocalDb(uid);
      if (!failWrites.on) return db;
      return new Proxy(db, {
        get(target, prop) {
          if (prop === 'delete' || prop === 'put' || prop === 'clear') return async () => { throw new Error('MARKER_IDB_DOWN'); };
          const v = Reflect.get(target, prop) as unknown;
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
  };
});

import { MemoryManagerModal } from '@/features/ai/components/MemoryManagerModal';
import { getLocalDb } from '@/core/storage/localDb';

const rec = (id: string, text: string, extra: Record<string, unknown> = {}) =>
  ({ id, kind: 'fact', text, sourceDialogueId: 'd1', createdAt: Number(id.slice(-1)), updatedAt: 1, sourceDocumentIds: [], ...extra });

beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  failWrites.on = false;
  const db = await getLocalDb();
  await db.clear('aiChatMemory');
  await db.put('aiChatMemory', rec('m1', 'MARKER_ПЕРВАЯ') as never);
  await db.put('aiChatMemory', rec('m2', 'MARKER_ВТОРАЯ', { sourceDialogueId: 'd2', sourceDocumentIds: undefined }) as never);
});

describe('MEM-1: окно памяти — запись, потом строка', () => {
  it('удаление отказало — строка на месте, тост ошибки', async () => {
    render(<MemoryManagerModal onClose={vi.fn()} />);
    await screen.findByText('MARKER_ПЕРВАЯ');
    failWrites.on = true;
    fireEvent.click(screen.getAllByRole('button', { name: 'ai_memory_delete' })[0]!);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('error_generic_action', 'error'));
    failWrites.on = false;
    expect(screen.getByText('MARKER_ВТОРАЯ')).toBeTruthy();
    expect(screen.getByText('MARKER_ПЕРВАЯ')).toBeTruthy();
    // и в хранилище запись жива
    expect(await (await getLocalDb()).get('aiChatMemory', 'm2')).toBeTruthy();
  });

  it('КОНТРОЛЬ: удаление прошло — строки нет, тоста нет', async () => {
    render(<MemoryManagerModal onClose={vi.fn()} />);
    await screen.findByText('MARKER_ВТОРАЯ');
    fireEvent.click(screen.getAllByRole('button', { name: 'ai_memory_delete' })[0]!);
    await waitFor(() => expect(screen.queryByText('MARKER_ВТОРАЯ')).toBeNull());
    expect(showToast).not.toHaveBeenCalled();
  });

  it('«забыть всё» отказало — список цел, тост ошибки', async () => {
    render(<MemoryManagerModal onClose={vi.fn()} />);
    await screen.findByText('MARKER_ПЕРВАЯ');
    failWrites.on = true;
    fireEvent.click(screen.getByRole('button', { name: /ai_memory_forget_all/ }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('error_generic_action', 'error'));
    expect(screen.getByText('MARKER_ПЕРВАЯ')).toBeTruthy();
    expect(screen.getByText('MARKER_ВТОРАЯ')).toBeTruthy();
  });

  it('«вернуть в контекст» отказало — пометка «источник неизвестен» остаётся, тост ошибки', async () => {
    render(<MemoryManagerModal onClose={vi.fn()} />);
    await screen.findByText('MARKER_ВТОРАЯ');
    failWrites.on = true;
    fireEvent.click(screen.getByRole('button', { name: 'ai_memory_return' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('error_generic_action', 'error'));
    expect(screen.getAllByTestId('memory-unknown-source')).toHaveLength(1);
  });
});
