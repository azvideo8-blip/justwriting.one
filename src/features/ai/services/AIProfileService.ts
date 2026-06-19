import { getLocalDb } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { getAuth } from 'firebase/auth';
import { getClient } from '../../../core/firebase/firestoreClient';
import { maybeEncrypt, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { analyzeWritingStyle } from '../utils/styleAnalyzer';

const PORTRAIT_LS_KEY = 'ai_user_portrait';

export const AIProfileService = {
  async savePortrait(portraitMarkdown: string): Promise<void> {
    localStorage.setItem(PORTRAIT_LS_KEY, portraitMarkdown);

    const uid = getAuth().currentUser?.uid;
    if (uid) {
      const encrypted = await maybeEncrypt(
        { aiPortrait: portraitMarkdown },
        ['aiPortrait'],
        [],
        true,
      );
      const { db, mod } = await getClient();
      await mod.setDoc(mod.doc(db, 'users', uid), encrypted, { merge: true });
    }
  },

  async getPortrait(): Promise<string | null> {
    const local = localStorage.getItem(PORTRAIT_LS_KEY);
    if (local) return local;

    const uid = getAuth().currentUser?.uid;
    if (uid) {
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
      const versions = await db.getAllFromIndex('versions', 'by-document', doc.id);
      if (versions.length > 0) {
        versions.sort((a, b) => b.version - a.version);
        styleContents.push(versions[0]?.content ?? '');
      }
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

    const aggregatedData = allSummaries.map(s => ({
      tone: s.tone,
      themes: s.themes,
      insights: s.insights,
      frequentWords: s.frequentWords,
      extractedFacts: s.extractedFacts ?? [],
    }));

    const allFacts = allSummaries.flatMap(s => s.extractedFacts ?? []);

    const result = await AIService.chat({
      personaId: 'custom',
      customSystemPrompt: `Вы — профессиональный психоаналитик и эксперт по психологическому портретированию. Ваша задача — на основе агрегированных данных дневниковых записей и конкретных фактов составить глубокий, поддерживающий и структурированный психологический портрет автора. Опишите паттерны его мышления, эмоциональные тенденции, сильные стороны и зоны роста. Избегайте вступительного или заключительного диалога, пишите отчет напрямую в формате Markdown.${preferences ? ' В конце портрета добавь раздел # Предпочтения в коммуникации.' : ''}`,
      messages: [{
        role: 'user',
        content: `На основе анализа ${allSummaries.length} текстов пользователя составь его психологический портрет. Вот агрегированные данные:\n\n${JSON.stringify(aggregatedData, null, 2)}\n\nКонкретные факты из текстов:\n${allFacts.map(f => `- ${f}`).join('\n')}${styleBlock}${preferencesBlock}\n\nОпиши паттерны мышления, эмоциональные тенденции, сильные стороны и зоны роста. Учитывай конкретные факты и события. Формат: markdown.`,
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
