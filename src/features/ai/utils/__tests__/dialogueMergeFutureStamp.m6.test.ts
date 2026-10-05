import { describe, it, expect } from 'vitest';
import { mergeDialogues, DIALOGUE_SCHEMA } from '../../../../core/storage/dialogueMerge';
import type { AIDialogue, DialogueMessage } from '../../../../core/storage/localDb';

// Характеризация, а не защита правки: этих тестов не было, пока стенд (M-6,
// сценарий 12 → сценарий 6) не показал, что делает с диалогом устройство с
// убежавшими вперёд часами. Красными на «базе» они быть не могут — краснота
// здесь означала бы, что поведение уже изменили. Смысл в другом: зафиксировать
// теперешний контракт, чтобы его смена была сознательным решением.
// Долг описан в justwriting-docs: ag-clock-skew-scalar-hostage-ticket.md.

const NOW = 1_700_000_000_000; // «сейчас» по честным часам
const DAY = 24 * 3600_000;

function dialogue(messages: DialogueMessage[], extra: Partial<AIDialogue> = {}): AIDialogue {
  return {
    id: 'd', title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    createdAt: 1000, updatedAt: 2000, messages, schema: DIALOGUE_SCHEMA, ...extra,
  };
}

const turn = (n: string): DialogueMessage[] => [
  { role: 'user', id: `u_${n}`, content: n, createdAt: 10 },
  { role: 'assistant', id: `a_${n}`, content: `на: ${n}`, createdAt: 11, turnId: `u_${n}` },
];

describe('M-6 следствие: копия, помеченная временем из будущего', () => {
  const base = [...turn('Привет')];

  it('скаляры достаются будущей копии, даже когда локальная изменена позже по честным часам', () => {
    // Облако пришёл от устройства с часами +сутки: собеседник в нём старый,
    // а отметка — NOW + сутки. Локальная копия меняла собеседника только что.
    const cloud = dialogue(base, { personaId: 'cbt', personaName: 'КПТ', updatedAt: NOW + DAY });
    const local = dialogue(base, { personaId: 'group_psychology', personaName: 'Группа', updatedAt: NOW });

    const merged = mergeDialogues(local, cloud, NOW);

    // Так работает LWW по updatedAt (src/core/storage/dialogueMerge.ts:218).
    expect(merged.personaId, 'скаляры сегодня берутся у копии с большей отметкой').toBe('cbt');
    // Реплики при этом не теряются: союз по id остаётся союзом.
    expect(merged.messages.map(m => m.content)).toEqual(['Привет', 'на: Привет']);
  });

  it('слияние с будущей копией ставит отметку ещё дальше в будущее — зараза не гаснет', () => {
    const cloud = dialogue(base, { personaId: 'cbt', updatedAt: NOW + DAY });
    const local = dialogue([...base, ...turn('Новый ход')], { personaId: 'group_psychology', updatedAt: NOW });

    const merged = mergeDialogues(local, cloud, NOW);

    expect(merged.updatedAt).toBeGreaterThan(NOW + DAY);
    // Следующий забор на третьем устройстве увидит exactly эту отметку и тоже
    // возьмёт скаляры из будущей копии.
    const third = mergeDialogues(dialogue(base, { personaId: 'coach', updatedAt: NOW }), merged, NOW);
    expect(third.personaId).toBe(merged.personaId);
  });

  it('отмена переключения собеседника переживает несколько проходов, а отметка стоит на месте', () => {
    const cloud = dialogue(base, { personaId: 'cbt', personaName: 'КПТ', updatedAt: NOW + DAY });
    let local = dialogue(base, { personaId: 'group_psychology', personaName: 'Группа', updatedAt: NOW });

    for (let pass = 0; pass < 3; pass++) {
      local = mergeDialogues(local, cloud, NOW + pass);
    }

    expect(local.personaId, 'смена собеседника откатана и не возвращается').toBe('cbt');
    // Совпал с облаком — отметка облака (правило S-34): то есть будущее не
    // ползёт вперёд, но и скаляры остаются замороженными ровно на величину
    // разрыва часов — здесь на сутки.
    expect(local.updatedAt).toBe(NOW + DAY);
  });

  it('рассуждение не распространяется на реплики: ход с устройства с убежавшими часами не затирает чужой', () => {
    // То, что поведение приемлемо для реплик, — отдельная часть контракта: её
    // проверяет и стендовый сценарий 12.
    const cloud = dialogue([...base, ...turn('Ход со_skewed_часов')], { updatedAt: NOW + DAY });
    const local = dialogue([...base, ...turn('Ход с честных часов')], { updatedAt: NOW });

    const merged = mergeDialogues(local, cloud, NOW);

    expect(new Set(merged.messages.map(m => m.content))).toEqual(new Set([
      'Привет', 'на: Привет', 'Ход со_skewed_часов', 'на: Ход со_skewed_часов',
      'Ход с честных часов', 'на: Ход с честных часов',
    ]));
  });
});
