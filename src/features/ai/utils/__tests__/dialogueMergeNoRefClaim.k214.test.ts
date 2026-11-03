import { describe, it, expect } from 'vitest';
import { mergeDialogues } from '../../../../core/storage/dialogueMerge';
import type { AIDialogue, DialogueMessage } from '../../../../core/storage/localDb';

// К21-4: признак «пересказ без ссылок» пишет только новый клиент. Копия со
// старого устройства приходит без поля — слияние не должно гасить пометку под
// ответом, который человек уже видел. Фикстуры синтетические.

const NOW = 1_700_000_000_000;

function dialogue(messages: DialogueMessage[]): AIDialogue {
  return {
    id: 'd', title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    createdAt: 1000, updatedAt: 2000, messages,
  };
}

const q: DialogueMessage = { role: 'user', id: 'u1', content: 'О чём я писал утром?', createdAt: 10 };
const flagged = (updatedAt: number): DialogueMessage => ({
  role: 'assistant', id: 'a1', content: 'В записях ты писал про подъём в шесть.', createdAt: 11, turnId: 'u1', updatedAt,
  notesClaimNoRef: true,
});
const plain = (updatedAt: number): DialogueMessage => ({
  role: 'assistant', id: 'a1', content: 'В записях ты писал про подъём в шесть.', createdAt: 11, turnId: 'u1', updatedAt,
});

describe('К21-4: слияние копий с признаком «пересказ без ссылок»', () => {
  it('признак живёт, когда свежая копия — та, где его нет', () => {
    const merged = mergeDialogues(dialogue([q, flagged(100)]), dialogue([q, plain(200)]), NOW);
    expect(merged.messages[1]?.notesClaimNoRef).toBe(true);
  });

  it('то же с другой стороны — порядок копий не важен', () => {
    const merged = mergeDialogues(dialogue([q, plain(200)]), dialogue([q, flagged(100)]), NOW);
    expect(merged.messages[1]?.notesClaimNoRef).toBe(true);
  });

  it('перегенерация на другом устройстве: под новым ответом прежней пометки нет', () => {
    const regenerated: DialogueMessage = {
      ...plain(200), content: 'В записях ты писал про подъём в шесть [#local_k214_found].',
    };
    const merged = mergeDialogues(dialogue([q, flagged(100)]), dialogue([q, regenerated]), NOW);
    expect(merged.messages[1]?.content).toBe(regenerated.content);
    expect(merged.messages[1]?.notesClaimNoRef).toBeUndefined();
  });

  it('обе копии без признака — пометки нет', () => {
    const merged = mergeDialogues(dialogue([q, plain(100)]), dialogue([q, plain(200)]), NOW);
    expect(merged.messages[1]?.notesClaimNoRef).toBeUndefined();
  });
});
