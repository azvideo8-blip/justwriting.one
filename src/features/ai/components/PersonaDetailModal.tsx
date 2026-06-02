import { useState } from 'react';
import { motion } from 'motion/react';
import { X, Trash2 } from 'lucide-react';
import { AIPersonaService } from '../services/AIPersonaService';
import { hasInjectionAttempt } from '../shared/injectionPatterns';
import { PERSONA_PROMPTS } from '../../../shared/ai/prompts';
import { useLanguage } from '../../../shared/i18n';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';

export interface PersonaDetailTarget {
  id: string;
  name: string;
  isPreset: boolean;
  systemPrompt?: string | undefined;
  color: string;
  mono: string;
}

interface PersonaDetailModalProps {
  persona: PersonaDetailTarget | null;
  onClose: () => void;
  onChanged: () => void;
}

function Mono({ color, mono }: { color: string; mono: string }) {
  const monoStyle = (color: string) => ({
    width: 36, height: 36, borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: `linear-gradient(180deg, ${color}30, ${color}14)`,
    border: `1px solid ${color}55`, color, fontWeight: 600, fontSize: 14,
  });
  return (
    <span
      style={monoStyle(color)}
    >
      {mono}
    </span>
  );
}

export function PersonaDetailModal({ persona, onClose, onChanged }: PersonaDetailModalProps) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);

  if (!persona) return null;

  // Re-seed local edit state whenever a different persona opens.
  if (editKey !== persona.id) {
    setEditKey(persona.id);
    setName(persona.name);
    setPrompt(persona.systemPrompt ?? '');
    setError(null);
  }

  const presetDescription = persona.isPreset
    ? (t(`ai_persona_desc_${persona.id}` as `ai_persona_desc_${string}`) ?? persona.name)
    : null;
  const presetPrompt = persona.isPreset ? (PERSONA_PROMPTS as Record<string, string>)[persona.id] ?? '' : '';

  const clientError = !persona.isPreset && hasInjectionAttempt(prompt)
    ? 'Обнаружена попытка инъекции. Измените формулировку.'
    : null;

  const handleSave = async () => {
    if (persona.isPreset || !name.trim() || !prompt.trim() || clientError) return;
    setValidating(true);
    setError(null);
    const result = await AIPersonaService.validate(prompt);
    if (!result.valid) {
      setError(result.reason ?? 'Промпт не прошёл валидацию');
      setValidating(false);
      return;
    }
    await AIPersonaService.update(persona.id, { name: name.trim(), systemPrompt: prompt.trim() });
    setValidating(false);
    onChanged();
    onClose();
  };

  const handleDelete = async () => {
    if (persona.isPreset) return;
    await AIPersonaService.delete(persona.id);
    onChanged();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative z-10 w-full max-w-md bg-surface-card border border-border-subtle rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border-subtle">
          <Mono color={persona.color} mono={persona.mono} />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-text-main truncate">{persona.name}</h3>
            <span className="text-[11px] text-text-main/40">
              {persona.isPreset ? 'Встроенная персона' : 'Ваша персона'}
            </span>
          </div>
          <IconButton onClick={onClose} className="p-1.5 rounded-lg text-text-main/40 hover:text-text-main transition-colors" label={t('close')} icon={<X size={18} />} />
        </div>

        <div className="p-5 space-y-4">
          {persona.isPreset ? (
            <>
              {presetDescription && (
                <div>
                  <label className="text-xs font-medium text-text-main/50 uppercase tracking-wide mb-1.5 block">Описание</label>
                  <p className="text-sm text-text-main/70 leading-relaxed">{presetDescription}</p>
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-text-main/50 uppercase tracking-wide mb-1.5 block">System prompt</label>
                <div className="px-3 py-2 rounded-xl bg-text-main/5 border border-border-subtle text-xs text-text-main/60 leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto">
                  {presetPrompt}
                </div>
                <p className="text-[10px] text-text-main/30 mt-1.5">Промпт встроенной персоны изменить нельзя.</p>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-text-main/50 uppercase tracking-wide">Имя</label>
                  <span className="text-[10px] font-mono text-text-main/25">{name.length}/30</span>
                </div>
                <input
                  value={name}
                  onChange={e => setName(e.target.value.slice(0, 30))}
                  className="w-full px-3 py-2 rounded-xl bg-text-main/5 border border-border-subtle text-sm text-text-main placeholder:text-text-main/30 outline-none focus:border-brand-soft/40"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-text-main/50 uppercase tracking-wide">System prompt</label>
                  <span className="text-[10px] font-mono text-text-main/25">{prompt.length}/500</span>
                </div>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value.slice(0, 500))}
                  rows={5}
                  className="w-full px-3 py-2 rounded-xl bg-text-main/5 border border-border-subtle text-sm text-text-main placeholder:text-text-main/30 outline-none focus:border-brand-soft/40 resize-none"
                />
                {(clientError || error) && <p className="text-xs text-accent-danger mt-1">{clientError || error}</p>}
              </div>
              <div className="flex items-center gap-2">
                <IconButton
                  onClick={() => void handleDelete()}
                  className="px-3 py-2.5 rounded-xl border border-border-subtle text-text-main/50 hover:text-accent-danger hover:border-accent-danger/30 transition-colors flex items-center justify-center"
                  title="Удалить персону"
                  label="Удалить персону"
                  icon={<Trash2 size={16} />}
                />
                <Button
                  onClick={() => void handleSave()}
                  disabled={!name.trim() || !prompt.trim() || !!clientError || validating}
                  className="flex-1 py-2.5 rounded-xl bg-brand-soft text-surface-base text-sm font-bold disabled:opacity-40 transition-colors"
                >
                  {validating ? 'Валидация…' : 'Сохранить'}
                </Button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
