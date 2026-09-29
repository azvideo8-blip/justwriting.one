import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { LanguageProvider } from '../../../shared/i18n';

// useLanguage вне провайдера бросает — компонент рендерится так же, как в приложении.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: LanguageProvider });
import { IndexingConsentModal } from '../components/IndexingConsentModal';

describe('LIFE-7: IndexingConsentModal content & wording', () => {
  it('displays the required Russian explanation regarding chunks and excluded notes', () => {
    render(
      <IndexingConsentModal
        isOpen={true}
        onRefuse={vi.fn()}
        onConsent={vi.fn()}
      />
    );

    const requiredText =
      'Текст заметок отправляется частями модели эмбеддингов для построения смыслового поиска. Заметки с пометкой «не показывать ИИ» не индексируются.';

    expect(screen.getByText(new RegExp(requiredText))).toBeInTheDocument();
  });

  /**
   * Согласие обязано говорить не только ЧТО уходит, но и КОГДА — это тот факт,
   * без которого согласие не осознанное. Решение LIFE-7 состояло ровно в этом.
   *
   * Формулировка сверялась с кодом дважды: сперва я утверждал, что заметка
   * уходит при сохранении, и это оказалось неправдой — слушатель жил только на
   * странице ИИ, а теперь удалён вовсе. Текст согласия, преувеличивающий объём
   * отправки, — не безопасная ошибка: по нему человек решает, что можно писать
   * в собственном дневнике.
   */
  it('говорит, КОГДА текст уходит, и что письмо само по себе не отправляет ничего', () => {
    render(
      <IndexingConsentModal
        isOpen={true}
        onRefuse={vi.fn()}
        onConsent={vi.fn()}
      />
    );

    expect(
      screen.getByText(/Само по себе письмо и сохранение заметки ничего не отправляют/),
      'без этой фразы согласие не описывает момент отправки',
    ).toBeInTheDocument();
    expect(
      screen.getByText(/когда вы запускаете разбор заметки/),
    ).toBeInTheDocument();
  });
});
