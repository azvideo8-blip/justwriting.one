import { translations } from '../i18n';

export const mapFirebaseError = (error: unknown, language: 'ru' | 'en' = 'ru'): string => {
  const code = error instanceof Error && 'code' in error ? (error as { code: string }).code : (error instanceof Error ? error.message : 'unknown');
  
  switch (code) {
    case 'permission-denied':
      return translations['error_permission_denied'][language];
    case 'unavailable':
      return translations['error_unavailable'][language];
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return translations['error_invalid_credentials'][language];
    case 'auth/too-many-requests':
      return translations['error_too_many_requests'][language];
    default:
      if (code.includes('AI Error')) {
        return translations['error_ai_resting'][language];
      }
      return translations['error_generic'][language];
  }
};
