// Модель сократила номер заметки многоточием — «[#local_d5751490…]» — и на
// экране остался сырой текст вместо ссылки. Однозначное начало достраивается.
import { describe, it, expect } from 'vitest';
import { sanitizeCitations } from '../useAIChat';

const ID = 'local_d5751490-1111-4222-8333-944445555666';
const OTHER = 'local_aa000000-1111-4222-8333-944445555666';

describe('sanitizeCitations: сокращённый номер', () => {
  it.each(['…', '...'])('«%s» в конце номера — ссылка на ту самую заметку', dots => {
    const out = sanitizeCitations(`Эта же тема звучит в заметке про «разность» [#local_d5751490${dots}].`, [ID, OTHER]);
    expect(out).toBe(`Эта же тема звучит в заметке про «разность» [#${ID}].`);
  });

  it('начало, которого нет среди заметок хода, убирается, а не печатается', () => {
    const out = sanitizeCitations('Тема звучит и тут [#local_ffff0000…].', [ID]);
    expect(out).toBe('Тема звучит и тут.');
  });

  it('неоднозначное начало убирается', () => {
    const out = sanitizeCitations('См. [#local_…].', [ID, OTHER]);
    expect(out).not.toContain('local_');
  });
});
