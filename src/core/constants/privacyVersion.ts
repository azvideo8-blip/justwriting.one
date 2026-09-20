// Версия текста политики и согласий. Константа, а не часть модуля с модалкой:
// её читают ProfileContext и настройки, и когда она жила в PrivacyModal.tsx,
// контекст профиля импортировал React-компонент ради одного числа. Это
// замыкало цикл ProfileContext → PrivacyModal → useAuthStatus → ProfileContext.
//
// Поднимать при изменении текста политики: значение сравнивается с
// privacyVersion и aiConsentVersion в профиле, и большее число означает, что
// согласие нужно собрать заново.
export const PRIVACY_VERSION = 3;
