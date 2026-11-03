import { describe, it, expect } from 'vitest';
import { mergeDialogues } from '../../../../core/storage/dialogueMerge';
import type { AIDialogue, DialogueMessage } from '../../../../core/storage/localDb';

// К21-3: список материалов хода пишет только новый клиент. Копия со старого
// устройства приходит без поля — слияние не должно ни терять сохранённый
// список, ни заменять его пустотой. Фикстуры синтетические.

const NOW = 1_700_000_000_000;

function dialogue(messages: DialogueMessage[]): AIDialogue {
  return {
    id: 'd', title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    createdAt: 1000, updatedAt: 2000, messages,
  };
}

const q: DialogueMessage = { role: 'user', id: 'u1', content: 'О чём я писал утром?', createdAt: 10 };
const withIds = (updatedAt: number): DialogueMessage => ({
  role: 'assistant', id: 'a1', content: 'Утром была пробежка.', createdAt: 11, turnId: 'u1', updatedAt,
  contextDocIds: ['local_k213_seen'],
});
const withoutIds = (updatedAt: number): DialogueMessage => ({
  role: 'assistant', id: 'a1', content: 'Утром была пробежка.', createdAt: 11, turnId: 'u1', updatedAt,
});

describe('К21-3: слияние копий со списком материалов хода', () => {
  it('поле живёт, когда свежая копия — та, где его нет', () => {
    const merged = mergeDialogues(dialogue([q, withIds(100)]), dialogue([q, withoutIds(200)]), NOW);
    expect(merged.messages[1]?.contextDocIds).toEqual(['local_k213_seen']);
  });

  it('то же с другой стороны — порядок копий не важен', () => {
    const merged = mergeDialogues(dialogue([q, withoutIds(200)]), dialogue([q, withIds(100)]), NOW);
    expect(merged.messages[1]?.contextDocIds).toEqual(['local_k213_seen']);
  });

  it('свежая копия со своим списком побеждает прежний', () => {
    const newer: DialogueMessage = { ...withIds(200), contextDocIds: ['local_k213_second'] };
    const merged = mergeDialogues(dialogue([q, withIds(100)]), dialogue([q, newer]), NOW);
    expect(merged.messages[1]?.contextDocIds).toEqual(['local_k213_second']);
  });

  it('перегенерация с тем же id: список старого ответа под новым текстом не переносится (ревью К21)', () => {
    const regenerated: DialogueMessage = { ...withoutIds(200), content: 'Другой ответ без материалов.' };
    const merged = mergeDialogues(dialogue([q, withIds(100)]), dialogue([q, regenerated]), NOW);
    expect(merged.messages[1]?.content).toBe('Другой ответ без материалов.');
    expect(merged.messages[1]?.contextDocIds).toBeUndefined();
  });
});

