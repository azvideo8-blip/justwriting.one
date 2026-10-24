import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { AIChatMessages } from '../components/chat/AIChatMessages';
import { LanguageProvider } from '../../../shared/i18n';
import { getLocalDb } from '../../../core/storage/localDb';
import { attachedTurn } from '../../../test/attachedTurnFixtures';

// LD-1: пост Editor'а, переписанный из дневника про работу с людьми, может
// пересказать чужую историю. Плашка сверки молчит про такие случаи (имён в посте
// нет), поэтому предупреждение о чужой истории — отдельная строка в том же
// стиле accent-warning. Фикстуры синтетические.
const visual = { color: '#888', mono: 'H', role: { ru: 'Роль', en: 'Role' } };

const NOTE_ID = 'local_ld1_note';
const NOTE_TEXT = 'Сегодня на сессии клиентка сказала, что не может отказать матери. Я заметил, как сам ушёл в советы.';
const TURN = attachedTurn(
  [{ documentId: NOTE_ID, title: 'Сессия', lastSessionAt: new Date('2026-10-01T12:00:00').getTime(), content: NOTE_TEXT }],
  'сделай пост',
);

async function seed(content: string = NOTE_TEXT) {
  const db = await getLocalDb();
  await db.put('documents', {
    id: NOTE_ID, title: 'Сессия', currentVersion: 1, lastSessionAt: Date.now(),
  } as never);
  await db.put('versions', { id: 'ver_ld1', documentId: NOTE_ID, version: 1, content } as never);
}

function renderChat(answer: string) {
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
        convPersonaId="editor"
        convPersonaName="Редактор"
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

describe('LD-1: предупреждение о чужой истории на плашке', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    for (const store of ['documents', 'versions'] as const) {
      const all = await db.getAll(store);
      for (const rec of all) await db.delete(store, (rec as { id: string }).id);
    }
    await seed();
  });

  it('пост с репликой клиента — предупреждение видно', async () => {
    renderChat('Клиентка сказала: «не могу отказать». И я ушёл в советы.\n\n— — —\nИз заметок: [#local_ld1_note]');
    await waitFor(() => expect(screen.getByText(/работа с клиентами/)).toBeInTheDocument());
  });

  // Служебные строки модели после «— — —» — не пост: там слово о клиенте не
  // должно рождать предупреждение.
  it('чужая история только в служебных строках после «— — —» — предупреждения нет', async () => {
    renderChat('Вечером дописал главу и выдохнул.\n\n— — —\nИз заметок: [#local_ld1_note]\nУбрано: пересказ сессии клиентки.');
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText(/работа с клиентами/)).toBeNull();
  });

  // Без имён, ролей и чисел плашки сверки нет — предупреждение живёт и само.
  it('предупреждение не зависит от плашки сверки', async () => {
    renderChat('Клиент вернулся с той же жалобой, что и в прошлом месяце.\n\n— — —\nИз заметок: [#local_ld1_note]');
    await waitFor(() => expect(screen.getByText(/работа с клиентами/)).toBeInTheDocument());
    expect(screen.queryByText(/Сверка с заметкой/)).toBeNull();
  });

  it('своя терапия автора — предупреждения нет', async () => {
    await seed('Мой терапевт помогает мне замечать, как я ухожу в шутки.');
    renderChat('Свою терапию я выбирал полгода.\n\n— — —\nИз заметок: [#local_ld1_note]');
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText(/работа с клиентами/)).toBeNull();
  });

  it('скрытая от ИИ заметка — ни плашки, ни предупреждения', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: NOTE_ID, title: 'Сессия', currentVersion: 1, lastSessionAt: Date.now(), excludedFromAI: true,
    } as never);
    renderChat('Клиентка сказала: «не могу отказать».\n\n— — —\nИз заметок: [#local_ld1_note]');
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText(/работа с клиентами/)).toBeNull();
    expect(screen.queryByText(/Сверка с заметкой/)).toBeNull();
  });
});
