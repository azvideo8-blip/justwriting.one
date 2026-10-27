import { describe, it, expect } from 'vitest';
import { sanitizeCitations } from '../useAIChat';
import { buildChatSystemPrompt, assembleChatPromptParams } from '../../../../shared/ai/buildChatPrompt';

// PA-7 (PR-11): в режиме списка EDITOR_NOTES_RULE снят (buildChatPrompt.ts:170) —
// ссылки «[#id]» разрешены в тексте поста. Разрешение формата не отменяет
// приватность: скрытая от ИИ заметка по-прежнему вырезается клиентским
// стражем, потому что её id не попадает в allowlist хода
// (useAIChat.ts:634 — citeIds строится с фильтром hiddenCiteIds).
//
// Мутация: снять фильтр `.filter(id => !hiddenCiteIds.has(id))` на :634 —
// скрытый id уезжает в allowlist; на уровне чистого стража это видно так:
// ответ со ссылкой на скрытый id, который не передан в injectedIds, обязан
// терять ссылку — и теряет независимо от того, серверный промпт в режиме
// списка или нет.
const VIS = 'local_p11_visible';
const HID = 'local_p11_hidden';
const LIST_ANSWER = `Про стоимость:

- я назвала сумму и замолчала [#${VIS}]
- разговор с клиенткой был про цену, а не про урок [#${HID}]`;

describe('PR-11: режим списка не снимает стража скрытых ссылок', () => {
  it('промпт в режиме списка ссылку разрешает (правило блока ссылок снято)', () => {
    const params = assembleChatPromptParams({
      personaId: 'editor',
      lastUserMessage: `[Прикреплена заметка: "Т"]\n\nвыпиши главное по датам`,
      documentContent: '[#local_p11_visible · 20261011]\nТекст видимой заметки',
    });
    const sys = buildChatSystemPrompt(params);
    expect(sys, 'LIST MODE не подставился').toContain('LIST MODE');
    expect(sys, 'правило «ссылки только в блоке» осталось — в списке оно должно быть снято').not.toContain('ссылки [#id] ставь только в блоке');
    // пост-формат в режиме списка не ставится (ANSWER FORMAT заменён LIST MODE)
    expect(sys, 'ANSWER FORMAT поста остался поверх LIST MODE').not.toContain('ANSWER FORMAT');
  });

  it('страж вырезает [#id] скрытой заметки из ответа списка', () => {
    // injectedIds хода = видимость + законные ссылки прошлых ответов, скрытых там нет.
    const cleaned = sanitizeCitations(LIST_ANSWER, [VIS], ['Т'], 'Текст видимой заметки');
    expect(cleaned).toContain(`[#${VIS}]`);
    expect(cleaned, 'ссылка на скрытую заметку осталась в ответе').not.toContain(HID);
  });

  it('контроль: без стража обе ссылки были бы целы — тест исполняется', () => {
    // тот же текст: если бы hidden id был в allowlist, ссылка бы сохранилась;
    // значит previous-кейс ловит ровно фильтр, а не пустую строку.
    const bothAllowed = sanitizeCitations(LIST_ANSWER, [VIS, HID], ['Т'], 'Текст видимой заметки');
    expect(bothAllowed).toContain(`[#${HID}]`);
  });
});
