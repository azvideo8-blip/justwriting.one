// NB-17 №7 (sus07): DatabaseExplorer — users со statusesFailed/truncated и
// user_versions с нечитаемыми рядами показывались как полная таблица без
// пометки. Компонент настоящий, AdminUserService/readCloudDocumentsPartial
// настоящие; моки только края (облако, провайдер ИИ, auth). Тост настоящий
// (ToastProvider), текст ru. Мутации: убрать пометки users/user_versions —
// красные а/б/в.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { DatabaseExplorer } from '../DatabaseExplorer';

const mocks = vi.hoisted(() => ({
  getUsers: vi.fn(),
  callAi: vi.fn(),
  getUserDocuments: vi.fn(),
  getAllVersionsForUser: vi.fn(),
}));

vi.mock('../../../../core/data', () => ({ DataProvider: { getUsers: (...a: unknown[]) => mocks.getUsers(...a) } }));
vi.mock('../../../../core/ai/callAi', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../core/ai/callAi')>();
  return { ...actual, callAi: (...a: unknown[]) => mocks.callAi(...a) };
});
vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: { getUserDocuments: (...a: unknown[]) => mocks.getUserDocuments(...a) },
}));
vi.mock('../../../../core/services/VersionService', () => ({
  VersionService: { getAllVersionsForUser: (...a: unknown[]) => mocks.getAllVersionsForUser(...a) },
}));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_admin' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const userRow = (i: number) => ({ id: `u_${i}`, email: `user${i}@example.com`, nickname: '', role: 'user' });
const STATUSES_FAILED_TEXT = 'Статусы приглашений и число заметок не загрузились — показан только список';
const TRUNCATED_TEXT = 'Показаны первые 150 — есть ещё';
const PARTIAL_TEXT = 'Часть строк облака не прочиталась: 1 — таблица неполная';

function renderExplorer() {
  return renderWithProviders(
    <ToastProvider>
      <DatabaseExplorer userId="u_admin" />
    </ToastProvider>
  );
}

async function switchToCloud(table?: string) {
  const cloudBtn = screen.getAllByRole('button').find(b => /облак|cloud/i.test(b.textContent ?? ''));
  expect(cloudBtn, 'переключатель источника «Облако»').toBeTruthy();
  fireEvent.click(cloudBtn!);
  if (table) fireEvent.change(screen.getByRole('combobox'), { target: { value: table } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUsers.mockResolvedValue([userRow(1)]);
  mocks.callAi.mockImplementation(async (endpoint: unknown) => {
    if (endpoint === 'listUsersWithStatus') return [];
    return {};
  });
  mocks.getUserDocuments.mockResolvedValue([]);
  mocks.getAllVersionsForUser.mockResolvedValue([]);
});
afterEach(cleanup);

describe('NB-17 №7: неполная таблица названа', () => {
  it('а) users: статусы не прочитались — пометка, а не тихий список', async () => {
    mocks.callAi.mockImplementation(async (endpoint: unknown) => {
      if (endpoint === 'listUsersWithStatus') throw new Error('SYNTHETIC_STATUSES');
      return {};
    });
    renderExplorer();
    await switchToCloud();
    expect(await screen.findByText(STATUSES_FAILED_TEXT)).toBeTruthy();
  });

  it('б) users: сервер отдал больше лимита — «показаны первые 150»', async () => {
    mocks.getUsers.mockResolvedValue(Array.from({ length: 151 }, (_, i) => userRow(i)));
    renderExplorer();
    await switchToCloud();
    expect(await screen.findByText(TRUNCATED_TEXT)).toBeTruthy();
  });

  it('в) user_versions: нечитаемый ряд заметки — пометка неполноты', async () => {
    const good = { id: 'doc_ok', userId: 'u_admin', title: 'Doc ok', currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [] };
    const e = Object.assign(new Error('UNREADABLE_CLOUD_LIST: 1'), { name: 'UnreadableCloudListError', docs: [good], ids: ['bad'], uuids: ['bad'] });
    mocks.getUserDocuments.mockRejectedValue(e);
    renderExplorer();
    await switchToCloud('user_versions');
    expect(await screen.findByText(PARTIAL_TEXT)).toBeTruthy();
  });

  it('контроль: users прочитаны целиком — пометок нет', async () => {
    renderExplorer();
    await switchToCloud();
    await waitFor(() => expect(mocks.getUsers).toHaveBeenCalled());
    expect(screen.queryByText(STATUSES_FAILED_TEXT)).toBeNull();
    expect(screen.queryByText(TRUNCATED_TEXT)).toBeNull();
    expect(screen.queryByText(PARTIAL_TEXT)).toBeNull();
  });
});