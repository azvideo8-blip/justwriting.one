import { translations } from '../../shared/i18n';

function tr(key: string, language: 'ru' | 'en'): string {
  const entry = translations[key];
  if (entry && entry[language]) return entry[language];
  return translations['error_generic']?.[language] ?? 'Error';
}

export const mapFirebaseError = (error: unknown, language: 'ru' | 'en' = 'ru'): string => {
  const code =
    (error !== null && typeof error === 'object' && 'code' in (error as object))
      ? (error as { code: string }).code
      : error instanceof Error
        ? error.message
        : 'unknown';
  
  switch (code) {
    case 'permission-denied':
      return tr('error_permission_denied', language);
    case 'unavailable':
      return tr('error_unavailable', language);
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return tr('auth_error_invalid_credential', language);
    case 'auth/too-many-requests':
      return tr('error_too_many_requests', language);
    default:
      return tr('error_generic', language);
  }
};
