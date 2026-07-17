import { getLocalDb, randomUUID } from '../../../core/storage/localDb';
import type { AIPersona } from '../../../core/storage/localDb';
import { getFunctions, httpsCallable } from 'firebase/functions';

export const PRESET_PERSONAS = [
  { id: 'group_psychology', name: 'Группа психологов', emoji: '\u{1FAC2}', isPreset: true },
  { id: 'cbt', name: 'КПТ-психолог', emoji: '\u{1F9E0}', isPreset: true },
  { id: 'coach', name: 'Коуч', emoji: '\u{1F680}', isPreset: true },
] as const;

export const PRESET_PERSONA_IDS = PRESET_PERSONAS.map(p => p.id);

export type PresetPersona = typeof PRESET_PERSONAS[number];

export const AIPersonaService = {
  async listCustom(): Promise<AIPersona[]> {
    const db = await getLocalDb();
    return db.getAll('aiPersonas');
  },

  async getCustom(id: string): Promise<AIPersona | undefined> {
    const db = await getLocalDb();
    return db.get('aiPersonas', id);
  },

  async create(data: { name: string; emoji: string; systemPrompt: string }): Promise<AIPersona> {
    const db = await getLocalDb();
    const persona: AIPersona = {
      id: randomUUID(),
      name: data.name,
      emoji: data.emoji,
      systemPrompt: data.systemPrompt,
      isPreset: false,
      createdAt: Date.now(),
    };
    await db.put('aiPersonas', persona);
    return persona;
  },

  async update(id: string, data: { name?: string; emoji?: string; systemPrompt?: string }): Promise<void> {
    const db = await getLocalDb();
    const existing = await db.get('aiPersonas', id);
    if (!existing) return;
    await db.put('aiPersonas', { ...existing, ...data });
  },

  async delete(id: string): Promise<void> {
    const db = await getLocalDb();
    await db.delete('aiPersonas', id);
  },

  async validate(systemPrompt: string): Promise<{ valid: boolean; reason?: string }> {
    const functions = getFunctions();
    const fn = httpsCallable<{ prompt: string }, { valid: boolean; reason?: string }>(
      functions, 'validateCustomPrompt'
    );
    try {
      const { data } = await fn({ prompt: systemPrompt });
      return data;
    } catch {
      return { valid: false, reason: 'Validation request failed.' };
    }
  },
};
