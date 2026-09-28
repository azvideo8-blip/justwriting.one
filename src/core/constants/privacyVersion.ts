// Переэкспорт: определение переехало в src/shared/ai/consentVersion.ts, чтобы его
// видел и api-слой (api/postgresAiContext.ts). Путь отсюда уже импортируют
// ProfileContext, PrivacyModal и настройки — менять его в коде смысла нет.
//
// Раньше константа жила здесь, и сервер держал собственное число: PRIVACY_VERSION
// подняли до 3, а сервер остался на 2 — из-за чего Настройки враньём показывали
// «Согласие не предоставлено» человеку с работающим ИИ (D-6).
export { AI_CONSENT_VERSION_REQUIRED } from '../../shared/ai/consentVersion';
