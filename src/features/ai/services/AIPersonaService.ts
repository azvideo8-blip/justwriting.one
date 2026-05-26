import { getLocalDb, randomUUID } from '../../../core/storage/localDb';
import type { AIPersona } from '../../../core/storage/localDb';
import { getFunctions, httpsCallable } from 'firebase/functions';

export const PRESET_PERSONAS = [
  { id: 'group_psychology', name: 'Группа психологов', emoji: '\u{1FAC2}', isPreset: true },
  { id: 'cbt', name: 'КПТ-психолог', emoji: '\u{1F9E0}', isPreset: true },
  { id: 'editor', name: 'Редактор', emoji: '\u270F\uFE0F', isPreset: true },
  { id: 'coach', name: 'Коуч', emoji: '\u{1F680}', isPreset: true },
  { id: 'journalist', name: 'Журналист', emoji: '\u{1F4F0}', isPreset: true },
] as const;

export const PRESET_PERSONA_DESCRIPTIONS: Record<string, string> = {
  group_psychology: 'Панель психологов разных школ — Роджерс, Бек, Франкл, Ялом — обсуждает твой текст с разных точек зрения и предлагает многогранный взгляд.',
  cbt: 'КПТ-психолог помогает найти автоматические мысли и когнитивные искажения. Мысли — не факты, а гипотезы, которые можно проверить.',
  editor: 'Опытный редактор улучшает ясность, структуру и поток текста, сохраняя твой авторский голос.',
  coach: 'Коуч помогает найти скрытую цель, переосмыслить ограничивающие убеждения и сформулировать конкретный следующий шаг.',
  journalist: 'Журналист превращает твои мысли в compelling narrative — находит угол подачи, структуру и главную историю.',
};

export type PresetPersona = typeof PRESET_PERSONAS[number];

export const AIPersonaService = {
  async listCustom(): Promise<AIPersona[]> {
    const db = await getLocalDb();
    return db.getAll('aiPersonas');
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
