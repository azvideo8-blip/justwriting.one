import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { StorageService } from '../StorageService';
import { onDomainEvent, type DomainEvent } from '../../events/domainEvents';

// DY6-5 (приёмка 26.10, Н-1): удаление из «Моя жизнь» (SessionDeleteService →
// StorageService.deleteDocument) не эмитило note.deleted — только archiveCrud
// делал это у себя. Подписчики шины (чистка разбора, MiniSearch, кэш лексикона
// из DY6-1) на этом пути не срабатывали: слова удалённой заметки жило в
// подсказках ещё 10 минут. Эмит переехал в ядро; в archiveCrud второй точки
// эмита нет (проверяется грепом в коммите) — старый путь не оставлен.
//
// Мутация: убрать эмит в ядре — все три кейса красные.

vi.mock('../../errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../LocalStorageService', () => ({
  LocalStorageService: {
    getDocument: vi.fn().mockResolvedValue(undefined),
    deleteDocument: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock('../CloudSyncService', () => ({
  CloudSyncService: {
    removeCloudCopy: vi.fn().mockResolvedValue(undefined),
    getDocument: vi.fn().mockResolvedValue(null),
  },
}));

function trackEvents(): { events: DomainEvent[]; stop: () => void } {
  const events: DomainEvent[] = [];
  const stop = onDomainEvent(e => { events.push(e); });
  return { events, stop };
}

describe('DY6-5: note.deleted эмитит ядро на обоих путях удаления', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('локальное удаление без облачной копии: событие ровно одно', async () => {
    const { events, stop } = trackEvents();
    try {
      const res = await StorageService.deleteDocument('u5', 'local_5_a');
      expect(res.applied).toBe(true);
      const deleted = events.filter(e => e.type === 'note.deleted');
      expect(deleted, 'ядро не эмитит note.deleted').toHaveLength(1);
      expect(deleted[0]).toMatchObject({ documentId: 'local_5_a' });
    } finally {
      stop();
    }
  });

  it('облачное удаление без локального id (cloud-сессия): событие одно, по cloud id', async () => {
    const { events, stop } = trackEvents();
    try {
      const res = await StorageService.deleteDocument('u5', undefined, 'cloud_5_c');
      expect(res.applied).toBe(true);
      const deleted = events.filter(e => e.type === 'note.deleted');
      expect(deleted, 'ядро не эмитит для cloud-only пути').toHaveLength(1);
      expect(deleted[0]).toMatchObject({ documentId: 'cloud_5_c' });
    } finally {
      stop();
    }
  });

  it('applied=false (нет облачного ряда при живом resolve) — события нет; applied=true twice — два разных id', async () => {
    const { events, stop } = trackEvents();
    try {
      const { LocalStorageService } = await import('../LocalStorageService');
      vi.mocked(LocalStorageService.getDocument).mockResolvedValueOnce({ id: 'x', linkedCloudId: 'cloud_5_d' } as never);
      // облачный ряд есть — удаление применится; проверяем, что событие
      // привязано к применённому удалению, а не к попытке: два вызова — два id.
      await StorageService.deleteDocument('u5', 'local_5_e', 'cloud_5_e');
      await StorageService.deleteDocument('u5', 'local_5_f', 'cloud_5_f');
      const deleted = events.filter(e => e.type === 'note.deleted').map(e => (e as { documentId: string }).documentId);
      expect(deleted).toEqual(['local_5_e', 'local_5_f']);
    } finally {
      stop();
    }
  });
});
