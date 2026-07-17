import { getLocalDb } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { getAuth } from 'firebase/auth';
import { getClient } from '../../../core/firebase/firestoreClient';
import { maybeEncrypt, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { analyzeWritingStyle } from '../utils/styleAnalyzer';
import { AIBackgroundBudget } from './AIBackgroundBudget';
import { reportError } from '../../../shared/errors/reportError';
import { useAiLimitStore } from '../store/useAiLimitStore';

const PORTRAIT_LS_KEY = 'ai_user_portrait';
const SECTIONS_CACHE_KEY = 'ai_portrait_sections';
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
    localStorage.setItem(PORTRAIT_LS_KEY, portraitMarkdown);

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
    } catch (e) {
      console.error('[AIProfileService] Failed to save portrait to IDB:', e);
    }

    const uid = getAuth().currentUser?.uid;
    if (uid) {
      try {
        const encrypted = await maybeEncrypt(
          { aiPortrait: portraitMarkdown },
          ['aiPortrait'],
          [],
          uid,
        );
        const { db, mod } = await getClient();
        await mod.setDoc(mod.doc(db, 'users', uid), encrypted, { merge: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('ENCRYPT_REQUIRED')) {
          console.warn('[AIProfileService] Cloud save skipped: E2E locked. Portrait saved locally.');
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
    try {
      const db = await getLocalDb();
      const cached = await db.get('aiPortrait', 'singleton');
      if (cached?.portrait) {
        localStorage.setItem(PORTRAIT_LS_KEY, cached.portrait);
        return cached.portrait;
      }
    } catch (e) {
      console.error('[AIProfileService] Failed to load portrait from IDB:', e);
    }

    const local = localStorage.getItem(PORTRAIT_LS_KEY);
    if (local) return local;

    const uid = getAuth().currentUser?.uid;
    if (uid) {
      try {
        const { db, mod } = await getClient();
        const snap = await mod.getDoc(mod.doc(db, 'users', uid));
        if (snap.exists()) {
          const data = snap.data() as Record<string, unknown>;
          if (data.aiPortrait) {
            const decrypted = await maybeDecrypt(data, ['aiPortrait'], []);
            const portrait = typeof decrypted.aiPortrait === 'string' ? decrypted.aiPortrait : '';
            localStorage.setItem(PORTRAIT_LS_KEY, portrait);
            return portrait;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('LOCKED') || msg.includes('session key not available')) {
          console.warn('[AIProfileService] Cloud fetch skipped: E2E locked.');
          return null;
        }
        throw e;
      }
    }
    return null;
  },

  async generate(): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
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
        const raw = localStorage.getItem(SECTIONS_CACHE_KEY);
        if (raw) cache = JSON.parse(raw);
      } catch { /* ignore */ }

      const sections = [
        {
          key: 'themes' as const,
          title: 'Темы и интересы',
          prompt: 'Ты — профессиональный психоаналитик. На основе тем профиля пользователя опиши его главные темы и интересы. НЕ рассуждай вслух — сразу результат в Markdown.',
          input: baseInput + styleBlock,
        },
        {
          key: 'emotional_patterns' as const,
          title: 'Эмоциональные паттерны',
          prompt: 'Ты — профессиональный психоаналитик. На основе тем профиля пользователя опиши его эмоциональные тенденции и паттерны мышления. НЕ рассуждай вслух — сразу результат в Markdown.',
          input: baseInput + styleBlock,
        },
        {
          key: 'strengths' as const,
          title: 'Сильные стороны',
          prompt: 'Ты — профессиональный психоаналитик. На основе тем профиля пользователя опиши его психологические сильные стороны. НЕ рассуждай вслух — сразу результат в Markdown.',
          input: baseInput,
        },
        {
          key: 'growth' as const,
          title: 'Зоны роста',
          prompt: 'Ты — профессиональный психоаналитик. На основе тем профиля пользователя опиши его зоны роста и направления развития. НЕ рассуждай вслух — сразу результат в Markdown.',
          input: baseInput,
        },
        {
          key: 'communication_prefs' as const,
          title: 'Стиль общения',
          prompt: 'Ты — профессиональный психоаналитик. На основе тем профиля пользователя, метрик стиля письма и предпочтений в общении с ИИ составь описание его стиля общения и предпочтений в коммуникации. НЕ рассуждай вслух — сразу результат в Markdown.',
          input: baseInput + styleBlock + (preferences ? `\n\nПредпочтения: ${preferences}` : ''),
        },
      ];

      const activeSections: Record<string, string> = {};

      for (const sec of sections) {
        const hash = await sha256Hex(sec.input);
        const cached = cache[sec.key];

        if (cached && cached.hash === hash && cached.content) {
          activeSections[sec.key] = cached.content;
        } else {
          // Regenerate section if budget allows
          if (AIBackgroundBudget.canSpend(1)) {
            const result = await AIService.chat({
              personaId: 'custom',
              customSystemPrompt: sec.prompt,
              messages: [{
                role: 'user',
                content: `${sec.title} на основе данных:\n\n${sec.input}\n\nНапиши подробный подраздел.`,
              }],
            });

            if (result.ok && result.text) {
              activeSections[sec.key] = result.text;
              cache[sec.key] = { content: result.text, hash };
              AIBackgroundBudget.spend(1);
            } else {
              // Fallback to cache if request fails
              activeSections[sec.key] = cached?.content || 'Раздел находится в процессе анализа…';
            }
          } else {
            // Re-use cache if out of budget
            activeSections[sec.key] = cached?.content || 'Раздел находится в процессе анализа…';
          }
        }
      }

      // Save sections cache
      try {
        localStorage.setItem(SECTIONS_CACHE_KEY, JSON.stringify(cache));
      } catch { /* ignore */ }

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
    const portrait = localStorage.getItem(PORTRAIT_LS_KEY);
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

      console.warn('[AIProfileService] Triggering auto-generation of psychological portrait...');
      const result = await this.generate();

      if (result.ok) {
        console.warn('[AIProfileService] Psychological portrait auto-generated successfully!');
      }
    } catch (e) {
      console.error('[AIProfileService] Failed to auto-generate portrait:', e);
    } finally {
      _autoGenInProgress = false;
    }
  }
};
