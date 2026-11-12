// Владелец 12.11: на «что я обещал себе после…» модель выдумала «контракт» и
// привязала его ссылками к настоящим заметкам. Страж цитат снимал кавычки и
// оставлял выдумку «по смыслу». В ходе «вопрос о записях» (флаг
// answer_chronicle_v2) предложение с цитатой, которой нет в материалах, уходит
// целиком. Мутация: убрать ветку dropFabricatedSentences → красный первый кейс.
import { describe, it, expect } from 'vitest';
import { sanitizeCitations } from '../useAIChat';

const MATERIALS = '[#n1 · 2026-11-09] В субботу я выпил около полулитра вина, спал поверхностно, воскресенье выпало из жизни.';
const ANSWER = 'В субботу ты выпил около полулитра вина [#n1]. '
  + 'Ты назвал это так: «год без всего лишнего и строгий контракт с собой на будущее» [#n1]. '
  + 'Воскресенье после этого «выпало из жизни» [#n1].';

describe('ход «вопрос о записях»: выдуманная цитата убирает предложение', () => {
  it('флаг: предложение с выдуманной цитатой удалено, остальное на месте', () => {
    const out = sanitizeCitations(ANSWER, ['n1'], [], MATERIALS, { personaId: 'coach', dropFabricatedSentences: true });
    expect(out).not.toContain('контракт');
    expect(out).toContain('полулитра вина');
    expect(out).toContain('«выпало из жизни»');
  });

  it('без флага — как раньше: кавычки сняты, слова остаются', () => {
    const out = sanitizeCitations(ANSWER, ['n1'], [], MATERIALS, { personaId: 'coach' });
    expect(out).toContain('контракт');
    expect(out).not.toContain('«год без всего лишнего');
  });

  it('если выдуманы все предложения — ответ не пустеет', () => {
    const only = 'Ты назвал это так: «год без всего лишнего и строгий контракт с собой на будущее» [#n1].';
    const out = sanitizeCitations(only, ['n1'], [], MATERIALS, { personaId: 'coach', dropFabricatedSentences: true });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('контракт');
  });
});
