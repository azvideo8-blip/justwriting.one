/**
 * SA-8: эталон тела запроса к чату.
 *
 * Прод (`api/ai/provider.ts`) и харнесы (`scripts/ai/*`, `scripts/rerank-bench/*`)
 * строят тело отсюда. Причина одна: харнес, который шлёт другое тело, измеряет
 * не прод. Так и вышло — `citation_faithfulness.mjs` отправлял
 * `temperature: 0` и НЕ отправлял `reasoning_effort: 'none'`, то есть видел
 * детерминированный ответ reasoning-модели там, где живой пользователь получает
 * ответ разогретой модели с дефолтной температурой.
 *
 * Что здесь «эталон», т. е. выверено на живом RouterAI, а не выбрано на вкус:
 *
 * - `reasoning_effort: 'none'`. Все, кто зовёт generate(), ждут ответ, а не цепочку
 *   рассуждений: это саммари, суждения, таксономии и извлечения. На OpenRouter это
 *   не требовало слов — reasoning там включался только по просьбе. RouterAI
 *   reasoning включён по умолчанию, он биллится и тратит `max_tokens`: запрос с
 *   узким бюджетом съедает всё на размышления и отдаёт пустой `content`.
 *   Переключатель, который работает, — ровно этот;
 *   `reasoning: { effort: 'low' }` дал больше размышлений, чем дефолт
 *   (374 токена против 61), а `{ exclude: true }` токены только прячет.
 *   Режим reasoning в чате включается тем же полем, которым его шлёт api/chat.ts.
 * - `temperature` не задаётся вообще: прод её не шлёт, и любое значение в
 *   харнесе — это другая модель поведения, чем у живого ответа.
 * - модель — `OPENROUTER_MODEL` с тем же фолбэком, что в проде. У ходов живого
 *   диалога своя модель (`AI_CHAT_MODEL`, см. `resolveAiChatModel` ниже):
 *   замер стенда arch-2026-10-11 двигает чат, а служебные вызовы (саммари,
 *   пунктуация, ранжирование, профиль) на этой модели не измерялись.
 */

export const DEFAULT_CHAT_MODEL = 'deepseek/deepseek-v4-flash';
/** Модель ходов диалога. Отдельный env с 0.9.37 (MD-1): смена чата не должна
 *  молча менять модель служебных вызовов, и наоборот. */
export const DEFAULT_AI_CHAT_MODEL = 'deepseek/deepseek-v4.1-flash';
export const DEFAULT_CHAT_BASE_URL = 'https://routerai.ru/api/v1';
export const DEFAULT_MAX_TOKENS = 4096;

export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function resolveChatModel(): string {
  return process.env.OPENROUTER_MODEL ?? DEFAULT_CHAT_MODEL;
}

/**
 * Модель живого диалога: потоковый ход и ветвь рассуждений в `api/chat.ts`,
 * плюс фолбэк `chatWithAI` (тот же разговор не должен отвечать двумя моделями).
 * Все `generate()` без явной модели (саммари, пунктуация, ранжирование, профиль,
 * память) остаются на `resolveChatModel()`.
 */
export function resolveAiChatModel(): string {
  return process.env.AI_CHAT_MODEL ?? DEFAULT_AI_CHAT_MODEL;
}

export function resolveChatBaseUrl(): string {
  return process.env.AI_BASE_URL ?? DEFAULT_CHAT_BASE_URL;
}

/**
 * Контур обработки. Пусто = ограничения нет, запрос может уйти к зарубежному
 * провайдеру (ст. 12 152-ФЗ). См. docs/audit-2026-09-20-outbound-pii.md (OUT-1).
 */
export function resolveProviderRouting(): { country: string } | undefined {
  return process.env.AI_PROVIDER_COUNTRY ? { country: process.env.AI_PROVIDER_COUNTRY } : undefined;
}

export interface ChatBodyParams {
  system?: string | undefined;
  messages: ChatMessage[];
  maxTokens?: number | undefined;
  model?: string | undefined;
  /** Развернуть reasoning на стороне провайдера. Не задан = `reasoning_effort: 'none'`. */
  reasoningEffort?: ReasoningEffort | undefined;
}

export function buildChatRequestBody(params: ChatBodyParams): Record<string, unknown> {
  // Только role и content: сообщения частично приходят из тела клиента
  // (editWithAI), и лишние поля не должны доезжать до провайдера.
  const own = params.messages.map(m => ({ role: m.role, content: m.content }));
  const messages: ChatMessage[] = params.system ? [{ role: 'system', content: params.system }, ...own] : own;

  const routing = resolveProviderRouting();

  const body: Record<string, unknown> = {
    model: params.model ?? resolveChatModel(),
    messages,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(routing ? { provider: routing } : {}),
  };

  if (params.reasoningEffort) body.reasoning = { effort: params.reasoningEffort };
  else body.reasoning_effort = 'none';

  return body;
}
