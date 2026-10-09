/**
 * Подпись кнопки микрофона: одна на три тулбара (title и aria-label). С ИИ-меткой
 * она обязана называть, что текст пойдёт в сервис за знаками препинания — этого
 * требует решение владельца 09.10.2026.
 */
export function dictationMicLabel(
  isListening: boolean,
  isVaultActive: boolean,
  withAi: boolean,
  t: (key: string) => string,
): string {
  if (isListening) return t('voice_stop');
  if (withAi) return t('voice_ai_mic_label');
  return isVaultActive ? `${t('voice_start')} (${t('voice_vault_badge')})` : t('voice_start');
}
