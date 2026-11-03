import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { AIChatMessages } from '../components/chat/AIChatMessages';
import { LanguageProvider } from '../../../shared/i18n';
import { getLocalDb } from '../../../core/storage/localDb';
import type { DialogueMessage } from '../../../core/storage/localDb';
import type { ArchiveSession } from '../../../shared/types/common';

// К21-3 (случай #21, 21.1 (3)): под ответом видно, какие заметки ушли модели.
// Человек спросил «откуда ты это взял», а проверить было нечего: список
// материалов нигде не показывался. Фикстуры синтетические.
const visual = { color: '#888', mono: 'H', role: { ru: 'Роль', en: 'Role' } };

const SEEN = 'local_k213_seen';
const SECOND = 'local_k213_second';
const HIDDEN = 'local_k213_hidden';
const TRASHED = 'local_k213_trashed';

async function seedNotes() {
  const db = await getLocalDb();
  for (const store of ['documents', 'versions'] as const) {
    for (const rec of await db.getAll(store)) await db.delete(store, (rec as { id: string }).id);
  }
  const now = Date.now();
  const notes: Array<[string, string, Record<string, unknown>]> = [
    [SEEN, 'Утренняя пробежка', {}],
    [SECOND, 'Разговор с сестрой', {}],
    [HIDDEN, 'Скрытая заметка', { excludedFromAI: true }],
    [TRASHED, 'Заметка в корзине', { trashedAt: now }],
  ];
  for (const [id, title, extra] of notes) {
    await db.put('documents', {
      id, guestId: 'u1', title, currentVersion: 1, totalWords: 10, totalDuration: 60,
      sessionsCount: 1, firstSessionAt: now, lastSessionAt: now, tags: [], ...extra,
    } as never);
    await db.put('versions', { id: `ver_${id}`, documentId: id, version: 1, content: `Тело заметки ${title}.` } as never);
  }
}

function renderChat(answer: DialogueMessage, onPreview: (s: ArchiveSession) => void = () => {}) {
  return render(
    <LanguageProvider>
      <AIChatMessages
        displayMessages={[{ role: 'user', content: 'о чём я писал утром?' }, answer]}
        streamingMessage={null}
        streamingReasoning={null}
        isLoading={false}
        error={null}
        clearError={() => {}}
        consentRequired={null}
        onOpenSettings={() => {}}
        convPersonaId="coach"
        convPersonaName="Коуч"
        convVisual={visual}
        onCopyMessage={() => {}}
        onDeleteMessage={() => {}}
        onFeedback={() => {}}
        onRegenerate={() => {}}
        onSwitchVariant={() => {}}
        onCreateNote={() => {}}
        onForcedSearch={() => {}}
        dailyLimitRemaining={10}
        followUps={[]}
        onSuggestion={() => {}}
        starters={[]}
        activeDialogueId="d1"
        activePersonaName="Коуч"
        headerVisual={visual}
        proactiveHint={null}
        setInputText={() => {}}
        isMobile={false}
        messagesEndRef={{ current: null }}
        previewSession={null}
        onClosePreview={() => {}}
        setCitationPreviewSession={onPreview}
      />
    </LanguageProvider>,
  );
}

const answerWith = (ids?: string[]): DialogueMessage => ({
  role: 'assistant',
  content: 'Утром была пробежка [#local_k213_seen].',
  ...(ids ? { contextDocIds: ids } : {}),
});

describe('К21-3: строка «Модель видела N заметок» под ответом', () => {
  beforeEach(async () => { await seedNotes(); });

  it('свёрнутая строка считает только видимые заметки и раскрывается в названия', async () => {
    renderChat(answerWith([SEEN, SECOND, HIDDEN, TRASHED, 'local_k213_gone']));
    const row = await screen.findByTestId('ai-context-notes');
    expect(within(row).getByText('Модель видела 2 заметки')).toBeInTheDocument();
    // Свёрнуто: названий не видно, пока строку не раскрыли.
    expect(screen.queryByText('Утренняя пробежка')).toBeNull();
    row.querySelector('summary')!.click();
    await waitFor(() => expect(screen.getByText('Утренняя пробежка')).toBeInTheDocument());
    expect(screen.getByText('Разговор с сестрой')).toBeInTheDocument();
    expect(screen.queryByText('Скрытая заметка')).toBeNull();
    expect(screen.queryByText('Заметка в корзине')).toBeNull();
  });

  it('название открывает заметку', async () => {
    const preview = vi.fn();
    renderChat(answerWith([SEEN]), preview);
    const row = await screen.findByTestId('ai-context-notes');
    row.querySelector('summary')!.click();
    (await screen.findByText('Утренняя пробежка')).click();
    await waitFor(() => expect(preview).toHaveBeenCalled());
    expect(preview.mock.calls[0]![0].id).toBe(SEEN);
  });

  it('без поля в реплике строки нет', async () => {
    renderChat(answerWith());
    await waitFor(() => expect(screen.getByText(/Утром была пробежка/)).toBeInTheDocument());
    expect(screen.queryByTestId('ai-context-notes')).toBeNull();
  });

  it('все заметки скрыты — строки нет', async () => {
    renderChat(answerWith([HIDDEN, TRASHED]));
    await waitFor(() => expect(screen.getByText(/Утром была пробежка/)).toBeInTheDocument());
    expect(screen.queryByTestId('ai-context-notes')).toBeNull();
  });
});
