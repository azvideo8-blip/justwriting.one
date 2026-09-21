export interface AiErrorToTextOptions {
  isLoggedIn?: boolean;
  t?: (key: string) => string;
}

/**
 * Unified error message formatter for AI operations across the app.
 * Resolves both localized keys (if t is provided) and default readable Russian messages.
 */
export function aiErrorToText(code: string | undefined | null, opts?: AiErrorToTextOptions): string {
  const t = opts?.t;
  const isLoggedIn = opts?.isLoggedIn ?? false;

  if (!code) {
    return t ? t('ai_error_server') : 'Произошла ошибка при отправке сообщения';
  }

  switch (code) {
    case 'RATE_LIMIT':
      return t
        ? t('ai_error_rate_limit')
        : 'Слишком частые запросы. Подождите немного перед следующей отправкой.';
    case 'DAILY_LIMIT':
      return t
        ? (t('ai_error_daily_limit') || 'Дневной лимит достигнут')
        : 'Дневной лимит достигнут';
    case 'REASONING_LIMIT':
      return 'Лимит рассуждений исчерпан';
    case 'SERVICE_UNAVAILABLE':
      return 'Сервис временно не может проверить лимит. Попробуйте позже.';
    case 'GLOBAL_LIMIT':
      return 'Лимит приложения исчерпан — попробуйте позже';
    case 'AUTH_REQUIRED':
      if (t) {
        return isLoggedIn ? t('ai_error_session') : t('ai_error_auth');
      }
      return isLoggedIn
        ? 'Не удалось подтвердить сессию — похоже, пропала связь. Попробуй ещё раз.'
        : 'Требуется регистрация';
    case 'AI_CONSENT_REQUIRED':
      return t
        ? (t('archive_preview_ai_consent_required') || 'Для общения с ИИ требуется согласие на обработку данных')
        : 'Для общения с ИИ требуется согласие на обработку данных';
    case 'EMPTY_RESPONSE':
      return 'ИИ не ответил — сервис временно недоступен (возможно, исчерпан лимит). Попробуйте позже.';
    case 'UPSTREAM':
      return 'Модель сейчас не отвечает — это сбой на стороне сервиса ИИ, а не в ваших заметках. Мы уже повторили запрос несколько раз. Попробуйте ещё раз через минуту.';
    case 'TOO_LONG':
      return t ? t('ai_error_too_long') : 'Запрос слишком длинный';
    case 'NO_CONTENT':
    case 'TOO_SHORT':
      return t ? t('ai_note_too_short') : 'Заметка слишком короткая для разбора';
    case 'EXCLUDED':
      return t ? t('ai_note_excluded') : 'Скрыто от ИИ';
    case 'NETWORK':
      return t ? t('ai_error_offline') : 'Проблема с подключением к сети. Проверьте соединение.';
    case 'MISCONFIGURED':
    case 'SERVER_ERROR':
    default:
      return t ? t('ai_error_server') : 'Произошла ошибка при отправке сообщения';
  }
}
