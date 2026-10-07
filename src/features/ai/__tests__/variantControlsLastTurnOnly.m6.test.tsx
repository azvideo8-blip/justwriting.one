// Страж формата: переключать вариант ответа и перегенерировать можно ТОЛЬКО
// последний ответ. Это не косметика — от него зависит, какие правки вообще
// доходят до сегментных окон. Пока контроль только у хвоста, содержимое
// ЗАКРЫТОГО окна меняется двумя способами: удалением реплики (стендовый сценарий
// 20) и допиской в открытое окно (17, 19). Появись правка середины — план
// `planDialogue` начал бы переоткрывать окна на каждый набор байтов, и ни один
// стендовый сценарий этого не проверяет. Тест краснеет ровно в тот момент, когда
// интерфейс начнёт давать листать варианты у несоседнего с хвостом ответа.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LanguageProvider } from '../../../shared/i18n';
import { AIChatMessages } from '../components/chat/AIChatMessages';

const visual = { color: '#888', mono: 'H', role: { ru: 'Роль', en: 'Role' } };

function renderTwoAnsweredTurns() {
  return render(
    <LanguageProvider>
      <AIChatMessages
        displayMessages={[
          { role: 'user', content: 'Вопрос первый' },
          // Оба ответа содержат по два варианта: если бы листание разрешали в
          // середине, счётчик появился бы дважды.
          { role: 'assistant', content: 'Ответ первый', variants: ['первый-а', 'первый-б'], variantIndex: 1 },
          { role: 'user', content: 'Вопрос второй' },
          { role: 'assistant', content: 'Ответ второй', variants: ['второй-а', 'второй-б'], variantIndex: 1 },
        ]}
        streamingMessage={null}
        streamingReasoning={null}
        isLoading={false}
        error={null}
        clearError={() => {}}
        consentRequired={null}
        onOpenSettings={() => {}}
                  convPersonaId="editor"
          convPersonaName="Помощник"
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
        activePersonaName="Помощник"
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

describe('переключение вариантов и перегенерация — только у последнего ответа', () => {
  it('счётчик вариантов стоит на одном-единственном ответе и показывает последний вариант', () => {
    const { container } = renderTwoAnsweredTurns();
    // Виджет листающих стрелок опознаётся по счётчику «N/M»: у стрелок
    // доступного имени нет (иконки aria-hidden).
    const counters = Array.from(container.querySelectorAll('span'))
      .map(s => (s.textContent ?? '').trim())
      .filter(t => /^\d+\/\d+$/.test(t));
    expect(counters, 'число счётчиков вариантов').toEqual(['2/2']);
  });

  it('кнопка «перегенерировать» одна — на последнем ответе', () => {
    const { getAllByRole } = renderTwoAnsweredTurns();
    const retry = getAllByRole('button', { name: /иначе|retry differently/i });
    expect(retry, 'кнопка перегенерации появляется у каждого ответа с вариантами').toHaveLength(1);
  });
});
