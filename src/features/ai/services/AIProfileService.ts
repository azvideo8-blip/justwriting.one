import { getLocalDb } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { getCurrentUser } from '../../../core/auth';
import { DataProvider } from '../../../core/data';
import { maybeEncrypt, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { analyzeWritingStyle } from '../utils/styleAnalyzer';
import { AIBackgroundBudget } from './AIBackgroundBudget';
import { reportError } from '../../../shared/errors/reportError';
import { useAiLimitStore } from '../store/useAiLimitStore';

import type { CallAiOptions } from '../../../core/ai/callAi';

/**
 * Кэш портрета в localStorage — ПРИВЯЗАН К АККАУНТУ.
 *
 * Раньше ключ был общий (`ai_user_portrait`), и это давало две беды сразу.
 * Выход из аккаунта чистит IndexedDB и ключи, помеченные uid'ом, — общий ключ
 * не попадал ни туда, ни туда, поэтому портрет со специальными категориями
 * (интимная жизнь, семья, имена третьих лиц) оставался в браузере открытым
 * текстом после «стереть всё с этого компьютера». А `getPortrait` читает
 * localStorage вторым шагом, когда в IndexedDB пусто, — то есть СЛЕДУЮЩИЙ
 * человек, вошедший в этом браузере, получал чужой портрет в подсказку на
 * каждом ходу чата.
 */
export function portraitCacheKey(uid: string | null | undefined): string {
  return uid ? `ai_user_portrait_${uid}` : 'ai_user_portrait_guest';
}

/** Ключ до привязки к аккаунту. Читается один раз — чтобы стереть. */
const LEGACY_PORTRAIT_LS_KEY = 'ai_user_portrait';
/**
 * Кэш разделов портрета — вторая копия того же текста, и та же беда, что была
 * у самого портрета: под общим ключом он переживал выход из аккаунта. Помечен
 * аккаунтом по той же причине.
 */
function sectionsCacheKey(uid: string | null | undefined): string {
  return uid ? `ai_portrait_sections_${uid}` : 'ai_portrait_sections_guest';
}
const LEGACY_SECTIONS_CACHE_KEY = 'ai_portrait_sections';
let _autoGenInProgress = false;

interface PortraitSectionCache {
  content: string;
  hash: string;
}

interface PortraitCacheData {
  themes?: PortraitSectionCache;
  emotional_patterns?: PortraitSectionCache;
  strengths?: PortraitSectionCache;
  growth?: PortraitSectionCache;
  communication_prefs?: PortraitSectionCache;
}

async function sha256Hex(str: string): Promise<string> {
  try {
    const msgUint8 = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Fallback if crypto is missing (e.g. non-secure origin)
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }
}

export const AIProfileService = {
  async savePortrait(portraitMarkdown: string): Promise<void> {
    localStorage.setItem(portraitCacheKey(getCurrentUser()?.uid), portraitMarkdown);

    try {
      const db = await getLocalDb();
      const allSummaries = await db.getAll('aiSummaries');
      const generatedAtDelta = allSummaries.length;
      await db.put('aiPortrait', {
        id: 'singleton',
        portrait: portraitMarkdown,
        updatedAt: Date.now(),
        generatedAtDelta
      });
      const { LocalStoreSyncService } = await import('../../../core/services/LocalStoreSyncService');
      LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    } catch (e) {
      console.error('[AIProfileService] Failed to save portrait to IDB:', e);
    }

    const uid = getCurrentUser()?.uid;
    if (uid) {
      try {
        const encrypted = await maybeEncrypt(
          { aiPortrait: portraitMarkdown },
          ['aiPortrait'],
          [],
          uid,
        );
        await DataProvider.updateProfile(uid, encrypted);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('ENCRYPT_REQUIRED')) {
          if (import.meta.env.DEV) console.warn('[AIProfileService] Cloud save skipped: E2E locked. Portrait saved locally.');
          return;
        }
        
        try {
          const db = await getLocalDb();
          const existing = await db.getAll('syncQueue');
          const hasPortrait = (existing ?? []).some(item => item.type === 'portrait' && item.documentId === uid);
          if (!hasPortrait) {
            await db.put('syncQueue', {
              id: `portrait_${uid}_${Date.now()}`,
              documentId: uid,
              type: 'portrait' as const,
              createdAt: Date.now(),
              ownerId: uid,
            });
          }
        } catch (queueErr) {
          console.error('[AIProfileService] Failed to add portrait task to syncQueue:', queueErr);
        }
      }
    }
  },

  async syncPortraitToCloud(userId: string): Promise<void> {
    return CloudSyncService.syncPortraitToCloud(userId);
  },

  async getPortrait(): Promise<string | null> {
    const uid = getCurrentUser()?.uid;
    const cacheKey = portraitCacheKey(uid);

    // Общий ключ прошлых сборок уносится при первом же чтении: он мог остаться
    // от другого человека, и подставлять его в подсказку нельзя.
    try {
      localStorage.removeItem(LEGACY_PORTRAIT_LS_KEY);
    } catch { /* ignore */ }

    try {
      const db = await getLocalDb();
      const cached = await db.get('aiPortrait', 'singleton');
      if (cached?.portrait) {
        localStorage.setItem(cacheKey, cached.portrait);
        return cached.portrait;
      }
    } catch (e) {
      console.error('[AIProfileService] Failed to load portrait from IDB:', e);
    }

    const local = localStorage.getItem(cacheKey);
    if (local) return local;

    if (uid) {
      try {
        const profile = await DataProvider.getProfile(uid);
        if (profile && profile.aiPortrait) {
          const decrypted = await maybeDecrypt(profile, ['aiPortrait'], []);
          const portrait = typeof decrypted.aiPortrait === 'string' ? decrypted.aiPortrait : '';
          localStorage.setItem(cacheKey, portrait);
          return portrait;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('LOCKED') || msg.includes('session key not available')) {
          if (import.meta.env.DEV) console.warn('[AIProfileService] Cloud fetch skipped: E2E locked.');
          return null;
        }
        throw e;
      }
    }
    return null;
  },

  async generate(opts?: CallAiOptions): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
    try {
      const db = await getLocalDb();
      const facets = await db.getAll('aiProfileFacets');

      // TICKET-053: Compile communication preferences from chat memory
      const chatMemories = await db.getAll('aiChatMemory');
      const preferences = chatMemories
        .filter(m => m.kind === 'preference')
        .map(m => `- ${m.text}`)
        .join('\n');

      // TICKET-054: Local writing style metrics
      const allDocs = await db.getAll('documents');
      const styleContents: string[] = [];
      for (const doc of allDocs) {
        const content = await LocalVersionService.getLatestContent(doc.id);
        if (content) styleContents.push(content);
      }
      const styleMetrics = analyzeWritingStyle(styleContents);
      const styleBlock = `\n\n[Метрики стиля письма: средняя длина слова ${styleMetrics.avgWordLength.toFixed(1)} симв, средняя длина предложения ${styleMetrics.avgSentenceLength.toFixed(1)} слов, восклицания ${styleMetrics.exclamationRate.toFixed(2)} на предложение, вопросы ${styleMetrics.questionRate.toFixed(2)} на предложение]`;

      let baseInput = '';
      if (facets.length >= 3) {
        baseInput = facets
          .sort((a, b) => b.noteCount - a.noteCount)
          .map(f => `**${f.label}** (${f.noteCount} заметок): ${f.summary}`)
          .join('\n');
      } else {
        const allSummaries = await db.getAll('aiSummaries');
        if (allSummaries.length < 3) {
          return { ok: false, error: 'NOT_ENOUGH_DATA' };
        }
        baseInput = allSummaries.map((s, i) => {
          const parts = [`Запись ${i + 1}:`];
          if (s.summary) parts.push(`  Суть: ${s.summary}`);
          if (s.tone) parts.push(`  Тон: ${s.tone}`);
          if (s.themes?.length) parts.push(`  Темы: ${s.themes.join(', ')}`);
          if (s.insights?.length) s.insights.forEach(ins => parts.push(`  • ${ins}`));
          return parts.join('\n');
        }).join('\n\n');
      }

      // Load cached sections
      let cache: PortraitCacheData = {};
      try {
        localStorage.removeItem(LEGACY_SECTIONS_CACHE_KEY);
        const raw = localStorage.getItem(sectionsCacheKey(getCurrentUser()?.uid));
        if (raw) cache = JSON.parse(raw);
      } catch { /* ignore */ }

      // Backlog "de-personalised portrait" (docs/backlog-ideas-2026-09-11.md),
      // a first pass at shape 2 — not a second stored version, just a stricter
      // prompt on the one that leaves the device with every chat message.
      // `baseInput` below carries names and situations by design (the facet
      // summariser is instructed to keep them literal, for accurate retrieval
      // — see summarizeFacet.logic.ts's SYSTEM_PROMPT); this instruction is
      // what turns that into character traits before it ever reaches Markdown.
      const abstractionRule = ' Описывай устойчивые черты характера, склонности и способы думать и чувствовать — а не конкретные события и обстоятельства. Не называй имена людей, места, даты, работодателей, диагнозы и прочую конкретику из заметок; встретив такую деталь во входных данных, обобщай её до свойства характера, которое за ней стоит (например, вместо «тяжело переживает развод с Иреной в 2019 году» — «тяжело переживает завершение значимых отношений»).';

      const sections = [
        {
          key: 'themes' as const,
          title: 'Темы и интересы',
          prompt: `Ты — профессиональный психоаналитик. На основе тем профиля пользователя опиши его главные темы и интересы (3-5 предложений, без заголовков и списков) — как области жизни и характер вовлечённости в них (любопытство, чувство долга, избегание), а не конкретные проекты или обстоятельства.${abstractionRule} НЕ рассуждай вслух — сразу результат в Markdown.`,
          input: baseInput + styleBlock,
        },
        {
          key: 'emotional_patterns' as const,
          title: 'Эмоциональные паттерны',
          prompt: `Ты — профессиональный психоаналитик. На основе тем профиля пользователя опиши его эмоциональные тенденции и паттерны мышления (3-5 предложений, без заголовков и списков).${abstractionRule} НЕ рассуждай вслух — сразу результат в Markdown.`,
          input: baseInput + styleBlock,
        },
        {
          key: 'strengths' as const,
          title: 'Сильные стороны',
          prompt: `Ты — профессиональный психоаналитик. На основе тем профиля пользователя опиши его психологические сильные стороны (3-5 предложений, без заголовков и списков).${abstractionRule} НЕ рассуждай вслух — сразу результат в Markdown.`,
          input: baseInput,
        },
        {
          key: 'growth' as const,
          title: 'Зоны роста',
          prompt: `Ты — профессиональный психоаналитик. На основе тем профиля пользователя опиши его зоны роста и направления развития (3-5 предложений, без заголовков и списков).${abstractionRule} НЕ рассуждай вслух — сразу результат в Markdown.`,
          input: baseInput,
        },
        {
          key: 'communication_prefs' as const,
          title: 'Стиль общения',
          prompt: `Ты — профессиональный психоаналитик. На основе тем профиля пользователя, метрик стиля письма и предпочтений в общении с ИИ составь описание его стиля общения и предпочтений в коммуникации (3-5 предложений, без заголовков и списков).${abstractionRule} НЕ рассуждай вслух — сразу результат в Markdown.`,
          input: baseInput + styleBlock + (preferences ? `\n\nПредпочтения: ${preferences}` : ''),
        },
      ];

      const activeSections: Record<string, string> = {};
      const generated = new Set<string>();

      for (const sec of sections) {
        // Hash the prompt along with the input: the cache otherwise keys only
        // on `input`, so editing a prompt (like the abstraction rule above)
        // would silently keep serving sections generated under the old one
        // to every account whose facets/summaries have not changed since.
        const hash = await sha256Hex(sec.prompt + sec.input);
        const cached = cache[sec.key];

        if (cached && cached.hash === hash && cached.content) {
          activeSections[sec.key] = cached.content;
          generated.add(sec.key);
        } else {
          // Regenerate section if budget allows
          if (AIBackgroundBudget.canSpend(1)) {
            const result = await AIService.chat({
              personaId: 'custom',
              callType: 'system_task',
              customSystemPrompt: sec.prompt,
              messages: [{
                role: 'user',
                content: `${sec.title} на основе данных:\n\n${sec.input}\n\n3-5 предложений, без заголовков и списков.`,
              }],
            }, ...(opts ? [opts] : []));

            if (result.ok && result.text) {
              activeSections[sec.key] = result.text;
              cache[sec.key] = { content: result.text, hash };
              generated.add(sec.key);
              AIBackgroundBudget.spend(1);
            } else {
              // Fallback to cache if request fails
              if (cached?.content) {
                activeSections[sec.key] = cached.content;
                generated.add(sec.key);
              } else {
                activeSections[sec.key] = 'Раздел находится в процессе анализа…';
              }
            }
          } else {
            // Re-use cache if out of budget
            if (cached?.content) {
              activeSections[sec.key] = cached.content;
              generated.add(sec.key);
            } else {
              activeSections[sec.key] = 'Раздел находится в процессе анализа…';
            }
          }
        }
      }

      // Save sections cache (so successfully generated sections are preserved for cheap retry)
      try {
        localStorage.setItem(sectionsCacheKey(getCurrentUser()?.uid), JSON.stringify(cache));
      } catch { /* ignore */ }

      // If any section failed generation and had no cached content, do NOT save a degraded portrait
      if (generated.size < sections.length) {
        return { ok: false, error: 'partial_generation_failed' };
      }

      // Reassemble final markdown
      const finalMarkdown = `# Психологический портрет пользователя

## Темы и интересы
${activeSections.themes}

## Эмоциональные паттерны
${activeSections.emotional_patterns}

## Сильные стороны
${activeSections.strengths}

## Зоны роста
${activeSections.growth}

## Стиль общения
${activeSections.communication_prefs}
`;

      await this.savePortrait(finalMarkdown);
      return { ok: true, markdown: finalMarkdown };
    } catch (e) {
      reportError(e, { action: 'ai_profile_generate' });
      return { ok: false, error: String(e) };
    }
  },

  async exportMarkdown(): Promise<string | null> {
    const portrait = localStorage.getItem(portraitCacheKey(getCurrentUser()?.uid));
    if (!portrait) return null;

    const blob = new Blob([portrait], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-profile-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    return portrait;
  },

  async autoGeneratePortrait(): Promise<void> {
    if (_autoGenInProgress) return;
    // Single-flight: claim the lock synchronously BEFORE any await, so concurrent
    // indexer callbacks can't both slip past the guard and double-fire generation.
    _autoGenInProgress = true;

    try {
      const db = await getLocalDb();
      const allSummaries = await db.getAll('aiSummaries');
      const summariesCount = allSummaries.length;

      // 1. Threshold of >= 20 analyzed summaries
      if (summariesCount < 20) return;

      const cached = await db.get('aiPortrait', 'singleton');

      // 2. Cooldown gate: minimum 1 hour since last generation
      const ONE_HOUR = 60 * 60 * 1000;
      if (cached && (Date.now() - cached.updatedAt < ONE_HOUR)) {
        return;
      }

      // 3. Delta of +5 summaries since last generation
      if (cached && (summariesCount - cached.generatedAtDelta < 5)) {
        return;
      }

      // 4. Remaining AI limit check: at least 5 remaining daily requests
      const { remaining } = useAiLimitStore.getState();
      if (remaining < 5) return;

      if (import.meta.env.DEV) console.warn('[AIProfileService] Triggering auto-generation of psychological portrait...');
      const result = await this.generate();

      if (result.ok) {
        if (import.meta.env.DEV) console.warn('[AIProfileService] Psychological portrait auto-generated successfully!');
      }
    } catch (e) {
      console.error('[AIProfileService] Failed to auto-generate portrait:', e);
    } finally {
      _autoGenInProgress = false;
    }
  }
};
