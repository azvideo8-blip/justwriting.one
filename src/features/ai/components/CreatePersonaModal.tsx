import { useState } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { AIPersonaService } from '../services/AIPersonaService';
import { hasInjectionAttempt } from '../shared/injectionPatterns';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { Input } from '../../../shared/components/Input';
import { Textarea } from '../../../shared/components/Textarea';

const SUGGESTED_EMOJIS = [
  '\u{1F9D1}', '\u{1F468}\u200D\u{1F4BC}', '\u{1F469}\u200D\u{1F4BC}',
  '\u{1F468}\u200D\u{1F52C}', '\u{1F469}\u200D\u{1F52C}', '\u{1F9D1}\u200D\u{1F384}',
  '\u{1F4DA}', '\u{1F3AF}', '\u{1F30D}', '\u{1F31F}',
  '\u{1F48E}', '\u{1F3A8}', '\u{1F3B5}', '\u{1F333}',
  '\u{1F52E}', '\u{1FA84}', '\u{1F9EC}', '\u{1F4AC}',
  '\u{1F91D}', '\u2728',
];

interface CreatePersonaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CreatePersonaModal({ isOpen, onClose, onCreated }: CreatePersonaModalProps) {
  const [emoji, setEmoji] = useState('\u{1F9D1}');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  if (!isOpen) return null;

  const clientValidationError = hasInjectionAttempt(prompt)
    ? 'Обнаружена попытка инъекции. Измените формулировку.'
    : null;

  const handleSubmit = async () => {
    if (!name.trim() || !prompt.trim() || clientValidationError) return;

    setValidating(true);
    setValidationError(null);

    const result = await AIPersonaService.validate(prompt);
    if (!result.valid) {
      setValidationError(result.reason ?? 'Промпт не прошёл валидацию');
      setValidating(false);
      return;
    }

    await AIPersonaService.create({ name: name.trim(), emoji, systemPrompt: prompt.trim() });
    setValidating(false);
    onCreated();
    onClose();
    setName('');
    setPrompt('');
    setEmoji('\u{1F9D1}');
  };

  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative z-10 w-full max-w-md bg-surface-card border border-border-subtle rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h3 className="text-sm font-bold text-text-main">Создать персону</h3>
          <IconButton onClick={onClose} className="p-1.5 rounded-lg text-text-main/60 hover:text-text-main transition-colors" label="Close" icon={<X size={18} />} />
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-text-main/60 uppercase tracking-wide mb-1.5 block">Эмодзи</label>
            <div className="relative">
              <Button
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className="w-12 h-12 p-0 rounded-xl bg-text-main/5 border border-border-subtle text-2xl flex items-center justify-center hover:bg-text-main/10 transition-colors"
              >
                {emoji}
              </Button>
              {showEmojiPicker && (
                <div className="absolute top-full left-0 mt-2 p-2 bg-surface-card border border-border-subtle rounded-xl shadow-xl grid grid-cols-10 gap-1 z-50">
                  {SUGGESTED_EMOJIS.map(e => (
                    <Button
                      key={e}
                      onClick={() => { setEmoji(e); setShowEmojiPicker(false); }}
                      className="w-8 h-8 p-0 text-lg rounded-lg hover:bg-text-main/10 flex items-center justify-center"
                    >
                      {e}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-text-main/60 uppercase tracking-wide">Имя</label>
              <span className="text-[10px] font-mono text-text-main/60">{name.length}/30</span>
            </div>
            <Input
              value={name}
              onChange={e => setName(e.target.value.slice(0, 30))}
              placeholder="Мудрый друг"
              className="px-3 py-2 rounded-xl bg-text-main/5 border border-border-subtle text-sm text-text-main placeholder:text-text-main/40 outline-none focus:border-brand-soft/40"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-text-main/60 uppercase tracking-wide">System prompt</label>
              <span className="text-[10px] font-mono text-text-main/60">{prompt.length}/500</span>
            </div>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value.slice(0, 500))}
              placeholder="Опишите роль персоны. Пример: 'Ты — мудрый друг, который...'"
              rows={4}
              className="px-3 py-2 rounded-xl bg-text-main/5 border border-border-subtle text-sm text-text-main placeholder:text-text-main/40 outline-none focus:border-brand-soft/40 resize-none"
            />
            {(clientValidationError || validationError) && (
              <p className="text-xs text-accent-danger mt-1">{clientValidationError || validationError}</p>
            )}
          </div>

          <Button
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || !prompt.trim() || !!clientValidationError || validating}
            className="w-full py-2.5 rounded-xl bg-brand-soft text-surface-base text-sm font-bold disabled:opacity-40 transition-colors"
          >
            {validating ? 'Валидация...' : 'Создать'}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
