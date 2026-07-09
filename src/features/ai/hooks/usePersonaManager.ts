import { useState, useCallback } from 'react';
import { AIPersonaService, PRESET_PERSONAS } from '../services/AIPersonaService';
import { personaVisual } from '../constants/personaVisuals';
import type { AIPersona } from '../../../core/storage/localDb';
import type { PersonaDetailTarget } from '../components/PersonaDetailModal';

export function usePersonaManager() {
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('group_psychology');
  const [customPersonas, setCustomPersonas] = useState<AIPersona[]>([]);
  const [createPersonaOpen, setCreatePersonaOpen] = useState(false);
  const [detailPersona, setDetailPersona] = useState<PersonaDetailTarget | null>(null);

  const loadCustomPersonas = useCallback(async () => {
    const list = await AIPersonaService.listCustom();
    setCustomPersonas(list);
  }, []);

  const allPersonas: { id: string; name: string; emoji: string; isPreset: boolean; systemPrompt?: string }[] = [
    ...PRESET_PERSONAS.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, isPreset: true })),
    ...customPersonas.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, isPreset: false, systemPrompt: p.systemPrompt })),
  ];

  const openPersonaDetail = useCallback((persona: typeof allPersonas[number]) => {
    const v = personaVisual(persona.id, persona.name);
    setDetailPersona({
      id: persona.id,
      name: persona.name,
      isPreset: persona.isPreset,
      systemPrompt: persona.systemPrompt,
      color: v.color,
      mono: v.mono,
    });
  }, []);

  return {
    selectedPersonaId,
    setSelectedPersonaId,
    customPersonas,
    setCustomPersonas,
    createPersonaOpen,
    setCreatePersonaOpen,
    detailPersona,
    setDetailPersona,
    loadCustomPersonas,
    allPersonas,
    openPersonaDetail,
  };
}
