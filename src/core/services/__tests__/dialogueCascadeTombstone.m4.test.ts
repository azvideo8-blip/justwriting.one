import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { LocalDocumentService } from '../LocalDocumentService';
import { LocalStoreSyncService } from '../LocalStoreSyncService';

// M-4, выживший прошлой проверки: каскад удаления заметки обязан оставлять
// надгробие диалога (S-58), а не стирать строку. Пока диалог стирался локально и
// удалялся в облаке, порядок «заметка ушла — разбор её переживает» не был ничем
// зафиксирован; тест краснеет, если в LocalDocumentService заменить
// put(tombstoneDialogue) + scheduleStoreSync на delete + scheduleStoreDelete.

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../auth', () => ({ getCurrentUser: () => ({ uid: 'u_m4' }) }));
vi.mock('../LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreDelete: vi.fn(), scheduleStoreSync: vi.fn() },
}));

const scheduleStoreSync = LocalStoreSyncService.scheduleStoreSync as ReturnType<typeof vi.fn>;
const scheduleStoreDelete = LocalStoreSyncService.scheduleStoreDelete as ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  const db = await getLocalDb('u_m4');
  for (const name of ['documents', 'aiDialogues', 'aiChatMemory', 'aiDialogueEvents', 'versions', 'syncQueue'] as const) {
    if (db.objectStoreNames.contains(name)) await db.clear(name);
  }
});

describe('M-4: каскад удаления заметки оставляет надгробие диалога', () => {
  it('диалог заметки становится надгробием и ставится в выгрузку, а не стирается', async () => {
    const db = await getLocalDb('u_m4');
    await db.put('documents', { id: 'local_9', title: 'Заметка', currentVersion: 1, guestId: 'u_m4' } as never);
    const dialogue: AIDialogue = {
      id: 'dlg_9',
      documentId: 'local_9',
      title: 'Разбор',
      personaId: 'coach',
      personaName: 'Коуч',
      personaEmoji: '🎯',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        { id: 'm1', role: 'user', content: 'Вопрос', createdAt: 1000 },
        { id: 'm2', role: 'assistant', content: 'Ответ', createdAt: 1001 },
      ],
    };
    await db.put('aiDialogues', dialogue as never);
    await db.put('aiChatMemory', { id: 'mem_9', sourceDialogueId: 'dlg_9', text: 'наблюдение' } as never);

    await LocalDocumentService.deleteDocument('local_9', 'u_m4');

    const after = (await db.get('aiDialogues', 'dlg_9')) as AIDialogue | undefined;
    expect(after, 'диалог стёрт вместо надгробия — облачная копия переживёт удаление').toBeDefined();
    expect(typeof after!.deletedAt).toBe('number');
    expect(after!.messages).toEqual([]);
    expect(scheduleStoreSync).toHaveBeenCalledWith('aiDialogues', 'dlg_9');
    expect(scheduleStoreDelete, 'диалог удалён в облаке — надгробие туда не доедет').not.toHaveBeenCalledWith('aiDialogues', 'dlg_9');
    // Память диалога при этом удаляется по-настоящему.
    expect(await db.get('aiChatMemory', 'mem_9')).toBeUndefined();
    expect(scheduleStoreDelete).toHaveBeenCalledWith('aiChatMemory', 'mem_9');
  });

  it('живой диалог другой заметки каскадом не задет', async () => {
    const db = await getLocalDb('u_m4');
    await db.put('documents', { id: 'local_a', title: 'А', currentVersion: 1, guestId: 'u_m4' } as never);
    await db.put('documents', { id: 'local_b', title: 'Б', currentVersion: 1, guestId: 'u_m4' } as never);
    await db.put('aiDialogues', {
      id: 'dlg_a', documentId: 'local_a', title: 'Т', personaId: 'p', personaName: 'P', personaEmoji: '',
      createdAt: 1, updatedAt: 2, messages: [{ id: 'm1', role: 'user', content: 'В', createdAt: 1 }],
    } as never);
    await db.put('aiDialogues', {
      id: 'dlg_b', documentId: 'local_b', title: 'Т', personaId: 'p', personaName: 'P', personaEmoji: '',
      createdAt: 1, updatedAt: 2, messages: [{ id: 'm2', role: 'user', content: 'В', createdAt: 1 }],
    } as never);

    await LocalDocumentService.deleteDocument('local_a', 'u_m4');

    const untouched = (await db.get('aiDialogues', 'dlg_b')) as AIDialogue;
    expect(untouched.deletedAt).toBeUndefined();
    expect(untouched.messages.length).toBe(1);
  });
});
