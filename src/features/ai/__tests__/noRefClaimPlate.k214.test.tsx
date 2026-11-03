import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { AIChatMessages } from '../components/chat/AIChatMessages';
import { LanguageProvider } from '../../../shared/i18n';
import type { DialogueMessage } from '../../../core/storage/localDb';
import type { ArchiveSession } from '../../../shared/types/common';

// К21-4 (случай #21, 21.2): под ответом видно, что источник не указан. Признак
// лежит в реплике — материалы хода не хранятся, и пересчитать его нельзя,
// поэтому пометка переживает перезагрузку и синхронизацию. Фикстуры синтетические.
const visual = { color: '#888', mono: 'H', role: { ru: 'Роль', en: 'Role' } };

function renderChat(answer: DialogueMessage) {
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
        setCitationPreviewSession={(_: ArchiveSession | null) => {}}
      />
    </LanguageProvider>,
  );
}

const PLATE_TEXT = 'Здесь нет ссылок на записи — источник не указан';

describe('К21-4: пометка «источник не указан» под ответом', () => {
  it('признак в реплике — пометка есть', async () => {
    renderChat({ role: 'assistant', content: 'В записях ты писал про подъём в шесть.', notesClaimNoRef: true });
    await waitFor(() => expect(screen.getByTestId('ai-no-note-refs')).toBeInTheDocument());
    expect(screen.getByTestId('ai-no-note-refs')).toHaveTextContent(PLATE_TEXT);
  });

  it('без признака пометки нет', async () => {
    renderChat({ role: 'assistant', content: 'В записях ты писал про подъём в шесть.' });
    await waitFor(() => expect(screen.getByText(/про подъём в шесть/)).toBeInTheDocument());
    expect(screen.queryByTestId('ai-no-note-refs')).toBeNull();
  });

  it('ответ со ссылкой — пометки нет', async () => {
    renderChat({ role: 'assistant', content: 'В записях ты писал про подъём в шесть [#local_k214_a].', notesClaimNoRef: false });
    await waitFor(() => expect(screen.getByText(/про подъём в шесть/)).toBeInTheDocument());
    expect(screen.queryByTestId('ai-no-note-refs')).toBeNull();
    expect(screen.queryByText(PLATE_TEXT)).toBeNull();
  });
});
