import { getLocalDb } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { getAuth } from 'firebase/auth';
import { getClient } from '../../../core/firebase/firestoreClient';
import { maybeEncrypt, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';

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
          const portrait = decrypted.aiPortrait as string;
          localStorage.setItem(PORTRAIT_LS_KEY, portrait);
          return portrait;
        }
      }
    }
    return null;
  },

  async generate(): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
    const db = await getLocalDb();
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
      personaId: 'group_psychology',
      messages: [{
        role: 'user',
        content: `На основе анализа ${allSummaries.length} текстов пользователя составь его психологический портрет. Вот агрегированные данные:\n\n${JSON.stringify(aggregatedData, null, 2)}\n\nКонкретные факты из текстов:\n${allFacts.map(f => `- ${f}`).join('\n')}\n\nОпиши паттерны мышления, эмоциональные тенденции, сильные стороны и зоны роста. Учитывай конкретные факты и события. Формат: markdown.`,
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
