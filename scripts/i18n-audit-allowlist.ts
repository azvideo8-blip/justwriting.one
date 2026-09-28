// Позволяет гейту i18n (G-1) видеть разницу между «проверено» и «не видно».
// Каждый файл здесь — известный долг: русский текст вне t() в JSX или в атрибутах
// placeholder/aria-label/title/alt. Запись убирается, когда файл переводит текст на
// ключи; новый файл попадает сюда только осознанно — без записи гейт краснеет.
//
// Долг вынесен отдельным тикетом: docs/ag-tickets-28.09.26-i18n-jsx-debt.md.

export const JSX_TEXT_ALLOWLIST: readonly string[] = [];

export const JSX_ATTR_ALLOWLIST: readonly string[] = [];
