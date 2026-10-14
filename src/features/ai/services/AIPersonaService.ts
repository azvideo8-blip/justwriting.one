import { getLocalDb, randomUUID } from '../../../core/storage/localDb';
import type { AIPersona } from '../../../core/storage/localDb';
import { callAi } from '../../../core/ai/callAi';
import { LocalStoreSyncService } from '../../../core/services/LocalStoreSyncService';

/** `nameInstrumental` — имя в творительном падеже для «Диалог с …»: подставить
 *  именительный в этот слот значит получить «Диалог с Группа психологов». */
export const PRESET_PERSONAS = [
  { id: 'group_psychology', name: 'Группа психологов', nameInstrumental: 'Группой психологов', emoji: '\u{1FAC2}', isPreset: true },
  { id: 'cbt', name: 'КПТ-психолог', nameInstrumental: 'КПТ-психологом', emoji: '\u{1F9E0}', isPreset: true },
  { id: 'coach', name: 'Коуч', nameInstrumental: 'Коучем', emoji: '\u{1F680}', isPreset: true },
  { id: 'editor', name: 'Редактор', nameInstrumental: 'Редактором', emoji: '\u{270D}\u{FE0F}', isPreset: true },
] as const;

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
    LocalStoreSyncService.scheduleStoreSync('aiPersonas', persona.id);
    return persona;
  },

  async update(id: string, data: { name?: string; emoji?: string; systemPrompt?: string }): Promise<void> {
    const db = await getLocalDb();
    const existing = await db.get('aiPersonas', id);
    if (!existing) return;
    await db.put('aiPersonas', { ...existing, ...data });
    LocalStoreSyncService.scheduleStoreSync('aiPersonas', id);
  },

  async delete(id: string): Promise<void> {
    const db = await getLocalDb();
    await db.delete('aiPersonas', id);
    LocalStoreSyncService.scheduleStoreDelete('aiPersonas', id);
  },

  async validate(systemPrompt: string): Promise<{ valid: boolean; reason?: string }> {
    try {
      const data = await callAi<{ valid: boolean; reason?: string }>('validateCustomPrompt', { prompt: systemPrompt });
      return data;
    } catch {
      return { valid: false, reason: 'Validation request failed.' };
    }
  },
};
