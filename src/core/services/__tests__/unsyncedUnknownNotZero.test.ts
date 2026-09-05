import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * «Неизвестно» — не «ноль».
 *
 * Признак отставания заметки от облака считается через
 * `lastSyncedCloudVersion`, а это поле пишется ровно в одном месте: при
 * выгрузке НОВОЙ версии уже связанной заметки. Первая выгрузка его не ставит,
 * восстановление из облака не ставит, задним числом не заполняет никто.
 *
 * Значит на существующем архиве оно не определено почти нигде. Если считать
 * такую заметку отставшей, индикатор объявит около ста семидесяти
 * неотправленных заметок на полностью синхронизированном архиве — в день
 * выкатки. Сигнал, срабатывающий на всё, хуже тишины, которую он заменил:
 * следующий, настоящий, пропустят мимо.
 *
 * Поэтому: пока истинное значение не выяснено, заметка «неизвестна» — не
 * отставшая и не синхронизированная.
 */

const getDocumentsByOwner = vi.fn();
const getCloudDocumentVersions = vi.fn();
const dbPut = vi.fn(async () => undefined);

vi.mock('../LocalDocumentService', () => ({ LocalDocumentService: { getDocumentsByOwner } }));
vi.mock('../DocumentService', () => ({ DocumentService: { getCloudDocumentVersions } }));
vi.mock('../StorageService', () => ({ StorageService: {} }));
vi.mock('../CloudSyncService', () => ({ CloudSyncService: {} }));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../shared/errors/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../storage/localDb', () => ({
  getLocalDb: vi.fn(async () => ({
    getAll: vi.fn(async () => []),
    transaction: vi.fn(() => ({ store: { put: dbPut }, done: Promise.resolve() })),
  })),
}));

const { SyncService } = await import('../SyncService');

/**
 * Заметка, связанная с облаком, но без записанной отметки о версии.
 *
 * Строится заново на каждый тест: разрешение МУТИРУЕТ документ, и общий объект
 * протекал бы из теста в тест — на этом сам и попался.
 */
const unresolved = () => ({
  id: 'local_1', uuid: 'u-1', guestId: 'user-1', title: 'Старая заметка',
  linkedCloudId: 'cloud_1', currentVersion: 1,
  totalWords: 500, totalDuration: 0, sessionsCount: 1,
  firstSessionAt: 1, lastSessionAt: 1, tags: [],
});

describe('незаполненная отметка о версии не считается отставанием', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocumentsByOwner.mockImplementation(async () => [unresolved()]);
  });

  it('облако недоступно → заметка «неизвестна», а не «не отправлена»', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    const summary = await SyncService.getUnsyncedSummary('user-1');

    expect(summary.hasUnknown, 'состояние заметки не выяснено').toBe(true);
    expect(summary.behindCount, 'неизвестное не должно попадать в отставшие').toBe(0);
    expect(summary.unsyncedCount, 'и не должно попадать в неотправленные').toBe(0);

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('чтение облака упало → тот же ответ: неизвестно, а не отставание', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    getCloudDocumentVersions.mockRejectedValue(new Error('network'));

    const summary = await SyncService.getUnsyncedSummary('user-1');

    expect(summary.hasUnknown).toBe(true);
    expect(summary.behindCount).toBe(0);
    expect(summary.unsyncedCount).toBe(0);
  });

  /**
   * Разрешение делается один раз и записывается: иначе запрос к облаку уходил
   * бы при каждом обновлении индикатора, а он живёт на подписке. Ровно так была
   * выбрана дневная квота чтений 31 июля.
   */
  it('выяснив истину, запоминает её в базе — чтобы не спрашивать облако снова', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    getCloudDocumentVersions.mockResolvedValue(new Map([['cloud_1', 1]]));

    const summary = await SyncService.getUnsyncedSummary('user-1');

    expect(getCloudDocumentVersions).toHaveBeenCalledOnce();
    expect(dbPut).toHaveBeenCalledWith(expect.objectContaining({ lastSyncedCloudVersion: 1 }));
    expect(summary.behindCount, 'облако знает ту же версию — отставания нет').toBe(0);
    expect(summary.hasUnknown).toBe(false);
  });

  it('облако действительно отстало → это отставание, а не неизвестность', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    getCloudDocumentVersions.mockResolvedValue(new Map([['cloud_1', 0]]));

    const summary = await SyncService.getUnsyncedSummary('user-1');

    expect(summary.behindCount).toBe(1);
    expect(summary.hasUnknown).toBe(false);
  });
});
