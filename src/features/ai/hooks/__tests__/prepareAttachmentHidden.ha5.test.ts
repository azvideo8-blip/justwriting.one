// HA-5 (дейлик 26.11): по адресу /ai?doc=… скрытая от ИИ заметка ложилась карточкой с
// названием в поле ввода. Настоящий useAIChat и IndexedDB; подменён контекст хода.
// Мутация: не проверять скрытие в prepareAttachment — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));
vi.mock('../../services/aiChatContext', () => ({
  useAIChatContext: () => ({ buildContext: vi.fn(), getAttachedNote: () => null, setAttachedNote: vi.fn(), getMessageCount: () => 1, incrementMessageCount: vi.fn(), resetSession: vi.fn() }),
}));

import { useAIChat } from '../useAIChat';
import { getLocalDb } from '../../../../core/storage/localDb';

const TEXT = 'MARKER_HA5_ATTACH синтетический текст заметки';
const doc = (id: string, over: object = {}) => ({ id, guestId: 'u1', title: `Название ${id}`, currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [], ...over });

beforeEach(async () => {
  const db = await getLocalDb();
  for (const s of ['documents', 'versions'] as const) await db.clear(s);
  for (const [id, over] of [['n_visible', { uuid: 'uuid_visible' }], ['n_hidden', { excludedFromAI: true, uuid: 'uuid_hidden' }], ['n_trashed', { trashedAt: 1 }]] as const) {
    await db.put('documents', doc(id, over) as never);
    await db.put('versions', { id: `v_${id}`, documentId: id, version: 1, content: TEXT, savedAt: 1, sessionStartedAt: 1, wordCount: 5, duration: 1, wpm: 1 } as never);
  }
});

describe('HA-5: прикрепление по ссылке и скрытая заметка', () => {
  it.each(['n_hidden', 'n_trashed'])('%s — не прикладывается', async id => {
    const { result } = renderHook(() => useAIChat(null, 'coach'));
    expect(await result.current.prepareAttachment(id)).toBeNull();
  });

  it('видимая — прикладывается (контроль)', async () => {
    const { result } = renderHook(() => useAIChat(null, 'coach'));
    expect(await result.current.prepareAttachment('n_visible')).toMatchObject({ title: 'Название n_visible', content: TEXT });
  });

  // DA-4 (ревью): ссылка /ai?doc= с постоянным номером. Мутация: искать только по
  // локальному id — красный (видимая не прикладывается).
  it('видимая по uuid — прикладывается; скрытая по uuid — нет', async () => {
    const { result } = renderHook(() => useAIChat(null, 'coach'));
    expect(await result.current.prepareAttachment('uuid_visible')).toMatchObject({ content: TEXT });
    expect(await result.current.prepareAttachment('uuid_hidden')).toBeNull();
  });
});
