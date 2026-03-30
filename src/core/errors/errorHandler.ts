export const mapFirebaseError = (error: any): string => {
  const code = error?.code || error?.message || 'unknown';
  
  switch (code) {
    case 'permission-denied':
      return 'У вас нет прав для выполнения этого действия.';
    case 'unavailable':
      return 'Сервис временно недоступен. Попробуйте позже.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Неверный email или пароль.';
    case 'auth/too-many-requests':
      return 'Слишком много попыток. Попробуйте позже.';
    default:
      if (code.includes('AI Error')) {
        return 'ИИ сейчас отдыхает. Попробуйте позже.';
      }
      return 'Произошла ошибка. Попробуйте позже.';
  }
};
