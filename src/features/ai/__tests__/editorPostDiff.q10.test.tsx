import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { AIChatMessages } from '../components/chat/AIChatMessages';
import { LanguageProvider } from '../../../shared/i18n';
import { getLocalDb } from '../../../core/storage/localDb';
import { attachedTurn } from '../../../test/attachedTurnFixtures';

// DLG-Q10 (Fable T-20): строка модели «что изменил» врёт — «ничего не изменено»,
// хотя имя убрано. Плашку считает код, и она положена только Редактору, только у
// ответа с разделителем «— — —» и только когда есть заметка-источник.
const visual = { color: '#888', mono: 'H', role: { ru: 'Роль', en: 'Role' } };

const NOTE_ID = 'local_editor_note';
const NOTE_TEXT = 'Утром позвонил Тимур, а Оля одолжила 54 000 и напомнила про 5:50.';
const POST = 'Брат позвонил рано утром. Подруга выручила деньгами, и всё это висит над головой.\n\n— — —\nИз заметок: [#local_editor_note]';
const TURN = attachedTurn(
  [{ documentId: NOTE_ID, title: 'Утро', lastSessionAt: new Date('2026-10-01T12:00:00').getTime(), content: NOTE_TEXT }],
  'сделай пост',
);

async function seed(doc: Record<string, unknown> = {}) {
  const db = await getLocalDb();
  await db.put('documents', {
    id: NOTE_ID, title: 'Утро', currentVersion: 1, lastSessionAt: Date.now(), ...doc,
  } as never);
  await db.put('versions', { id: 'ver_1', documentId: NOTE_ID, version: 1, content: NOTE_TEXT } as never);
}

function renderChat(personaId: string, answer: string = POST, dialogueDocumentId?: string) {
  return render(
    <LanguageProvider>
      <AIChatMessages
        displayMessages={[
          { role: 'user', content: TURN },
          { role: 'assistant', content: answer },
        ]}
        streamingMessage={null}
        streamingReasoning={null}
        isLoading={false}
        error={null}
        clearError={() => {}}
        consentRequired={null}
        onOpenSettings={() => {}}
        convPersonaId={personaId}
        convPersonaName="Редактор"
        dialogueDocumentId={dialogueDocumentId}
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
        activePersonaName="Редактор"
        headerVisual={visual}
        proactiveHint={null}
        setInputText={() => {}}
        isMobile={false}
        messagesEndRef={{ current: null }}
        previewSession={null}
        onClosePreview={() => {}}
        setCitationPreviewSession={() => {}}
      />
    </LanguageProvider>,
  );
}

describe('Q-10: плашка сверки поста с заметкой', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    for (const store of ['documents', 'versions'] as const) {
      const all = await db.getAll(store);
      for (const rec of all) await db.delete(store, (rec as { id: string }).id);
    }
    await seed();
  });

  it('Редактор видит, какие имена и числа убраны и какие роли добавлены', async () => {
    renderChat('editor');
    await waitFor(() => expect(screen.getByText(/Сверка с заметкой/)).toBeInTheDocument());
    const plate = screen.getByText(/Сверка с заметкой/).parentElement?.textContent ?? '';
    expect(plate).toContain('убраны имена — Тимур, Оля');
    expect(plate).toContain('убраны числа');
    expect(plate).toContain('добавлены роли — брат, подруга');
  });

  it('у другой персоны плашки нет', async () => {
    renderChat('coach');
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText(/Сверка с заметкой/)).toBeNull();
  });

  it('заметка скрыта от ИИ — плашки нет', async () => {
    await seed({ excludedFromAI: true });
    renderChat('editor');
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText(/Сверка с заметкой/)).toBeNull();
  });

  it('нет строки «— — —» — плашки нет', async () => {
    renderChat('editor', 'Просто текст без служебного блока.');
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText(/Сверка с заметкой/)).toBeNull();
  });

  it('плашка считает имя, оставленное в другом падеже, как не убранное', async () => {
    renderChat('editor', 'Олю пришлось уговаривать, и брат позвонил сам.\n\n— — —\nИз заметок: [#local_editor_note]');
    await waitFor(() => expect(screen.getByText(/Сверка с заметкой/)).toBeInTheDocument());
    const plate = screen.getByText(/Сверка с заметкой/).parentElement?.textContent ?? '';
    expect(plate).toContain('Тимур');
    expect(plate).not.toContain('Оля');
  });

  // R-4 (ревью 07.10): строка «имена и числа не изменены» — непроверяемое
  // утверждение, при пустой сверке плашки нет вовсе.
  it('сверка ничего не нашла — плашки нет', async () => {
    renderChat('editor', `${NOTE_TEXT}\n\n— — —\nИз заметок: [#local_editor_note]`);
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText(/Сверка с заметкой/)).toBeNull();
    expect(screen.queryByText(/не изменены/)).toBeNull();
  });

  it('имя в начале заметки, убранное из поста, видно в плашке', async () => {
    await seed();
    const db = await getLocalDb();
    await db.put('versions', { id: 'ver_2', documentId: NOTE_ID, version: 2, content: 'Оля написала первой. Тимур звонил в 5:50.' } as never);
    renderChat('editor', 'Подруга написала первой. Брат звонил рано.\n\n— — —\nИз заметок: [#local_editor_note]');
    await waitFor(() => expect(screen.getByText(/Сверка с заметкой/)).toBeInTheDocument());
    const plate = screen.getByText(/Сверка с заметкой/).parentElement?.textContent ?? '';
    expect(plate).toContain('Оля');
    expect(plate).toContain('Тимур');
  });

  // ED-2: неубранное имя — предупреждение перед публикацией, и оно над плашкой.
  it('оставленное имя — предупреждение надо плашкой, плашка на месте', async () => {
    renderChat('editor', 'Оля позвонила утром, и это надо учесть.\n\n— — —\nИз заметок: [#local_editor_note]');
    await waitFor(() => expect(screen.getByText(/Сверка с заметкой/)).toBeInTheDocument());
    const warning = screen.getByText(/В посте остались имена/);
    expect(warning.textContent).toContain('Оля');
    // ED-2 + ревизия: заглавное внутри фразы — это и топоним, поэтому плашка
    // просит проверить, а не утверждает, что нашла только имена.
    expect(warning.textContent).toContain('имена или названия');
    expect(warning.textContent).toContain('проверь перед публикацией');
    // Плашка сверки не поехала: имена убранных и числа как раньше.
    const plate = screen.getByText(/Сверка с заметкой/).parentElement?.textContent ?? '';
    expect(plate).toContain('убраны имена — Тимур');
    expect(plate).toContain('убраны числа');
    // Предупреждение стоит первым в DOM относительно плашки.
    const plateEl = screen.getByText(/Сверка с заметкой/).closest('div');
    const warnEl = warning.closest('div');
    expect(warnEl && plateEl ? warnEl.compareDocumentPosition(plateEl) & Node.DOCUMENT_POSITION_FOLLOWING : 0).toBeTruthy();
  });

  it('нечего показывать — ни плашки, ни предупреждения', async () => {
    const db = await getLocalDb();
    await db.put('versions', { id: 'ver_3', documentId: NOTE_ID, version: 3, content: 'Каркас держится, обшивку отложим.' } as never);
    renderChat('editor', 'Каркас держится, обшивку отложим.\n\n— — —\nИз заметок: [#local_editor_note]');
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText(/Сверка с заметкой/)).toBeNull();
    expect(screen.queryByText(/В посте остались имена/)).toBeNull();
  });
});

