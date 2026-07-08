import { getLocalDb } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { getAuth } from 'firebase/auth';
import { getClient } from '../../../core/firebase/firestoreClient';
import { maybeEncrypt, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { analyzeWritingStyle } from '../utils/styleAnalyzer';

const PORTRAIT_LS_KEY = 'ai_user_portrait';

export const AIProfileService = {
  async savePortrait(portraitMarkdown: string): Promise<void> {
    localStorage.setItem(PORTRAIT_LS_KEY, portraitMarkdown);

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
          console.warn('[AIProfileService] Cloud save skipped: E2E locked (session key not available). Portrait saved locally.');
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

  // Delegates to CloudSyncService (core) — the sync-queue drain (also core)
  // calls that directly since core must not import from features/ai.
  async syncPortraitToCloud(userId: string): Promise<void> {
    return CloudSyncService.syncPortraitToCloud(userId);
  },

  async getPortrait(): Promise<string | null> {
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
    const db = await getLocalDb();
    const facets = await db.getAll('aiProfileFacets');

    // TICKET-053: Compile communication preferences from chat memory
    const chatMemories = await db.getAll('aiChatMemory');
    const preferences = chatMemories
      .filter(m => m.kind === 'preference')
      .map(m => `- ${m.text}`)
      .join('\n');
    const preferencesBlock = preferences
      ? `\n\n## Предпочтения в коммуникации\nПользователь выражал следующие предпочтения по стилю общения с ИИ:\n${preferences}\n\nУчитывай эти предпочтения в разделе «Предпочтения в коммуникации» в конце портрета.`
      : '';

    // TICKET-054: Local writing style metrics
    const allDocs = await db.getAll('documents');
    const styleContents: string[] = [];
    for (const doc of allDocs) {
      const content = await LocalVersionService.getLatestContent(doc.id);
      if (content) styleContents.push(content);
    }
    const styleMetrics = analyzeWritingStyle(styleContents);
    const styleBlock = `\n\n[Метрики стиля письма: средняя длина слова ${styleMetrics.avgWordLength.toFixed(1)} симв, средняя длина предложения ${styleMetrics.avgSentenceLength.toFixed(1)} слов, восклицания ${styleMetrics.exclamationRate.toFixed(2)} на предложение, вопросы ${styleMetrics.questionRate.toFixed(2)} на предложение]`;

    if (facets.length >= 3) {
      const facetInput = facets
        .sort((a, b) => b.noteCount - a.noteCount)
        .map(f => `**${f.label}** (${f.noteCount} заметок): ${f.summary}`)
        .join('\n');

      const result = await AIService.chat({
        personaId: 'custom',
        customSystemPrompt: `Ты — профессиональный психоаналитик. На основе тем профиля пользователя составь глубокий, поддерживающий психологический портрет. Опиши паттерны мышления, эмоциональные тенденции, сильные стороны и зоны роста. НЕ рассуждай вслух — сразу результат в Markdown. Опирайся ТОЛЬКО на приведённые данные, ничего не выдумывай.${preferences ? ' В конце портрета добавь раздел # Предпочтения в коммуникации, обобщив пользовательские предпочтения по стилю общения.' : ''}`,
        messages: [{
          role: 'user',
          content: `Темы профиля пользователя (из ${facets.reduce((s, f) => s + f.noteCount, 0)} заметок):\n\n${facetInput}${styleBlock}${preferencesBlock}\n\nСоставь психологический портрет: паттерны мышления, эмоциональные тенденции, сильные стороны и зоны роста. Формат: markdown.`,
        }],
      });

      if (result.ok) {
        await this.savePortrait(result.text);
        return { ok: true, markdown: result.text };
      }
      return { ok: false, error: result.error };
    }

    const allSummaries = await db.getAll('aiSummaries');
    if (allSummaries.length < 3) {
      return { ok: false, error: 'NOT_ENOUGH_DATA' };
    }

    const summaryLines = allSummaries.map((s, i) => {
      const parts: string[] = [`Запись ${i + 1}:`];
      if (s.summary) parts.push(`  Суть: ${s.summary}`);
      if (s.tone) parts.push(`  Тон: ${s.tone}`);
      if (s.themes?.length) parts.push(`  Темы: ${s.themes.join(', ')}`);
      if (s.insights?.length) s.insights.forEach(ins => parts.push(`  • ${ins}`));
      if (s.extractedFacts?.length) s.extractedFacts.forEach(f => parts.push(`  → ${f}`));
      return parts.join('\n');
    }).join('\n\n');

    const result = await AIService.chat({
      personaId: 'custom',
      customSystemPrompt: `Вы — профессиональный психоаналитик и эксперт по психологическому портретированию. Ваша задача — на основе дневниковых записей составить глубокий, поддерживающий и структурированный психологический портрет автора. Опишите паттерны его мышления, эмоциональные тенденции, сильные стороны и зоны роста. НЕ рассуждайте вслух — сразу результат в Markdown. Опирайтесь ТОЛЬКО на приведённые данные, ничего не выдумывайте.${preferences ? ' В конце портрета добавьте раздел # Предпочтения в коммуникации.' : ''}`,
      messages: [{
        role: 'user',
        content: `Данные из ${allSummaries.length} дневниковых записей:\n\n${summaryLines}${styleBlock}${preferencesBlock}\n\nСоставь психологический портрет: паттерны мышления, эмоциональные тенденции, сильные стороны и зоны роста. Формат: markdown.`,
      }],
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    await this.savePortrait(result.text);
    return { ok: true, markdown: result.text };
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
};
