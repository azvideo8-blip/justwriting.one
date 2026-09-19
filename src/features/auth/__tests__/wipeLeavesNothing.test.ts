import { describe, it, expect, beforeEach } from 'vitest';
import { clearAccountScopedStorage } from '../services/accountScopedKeys';

/**
 * «Выйти и стереть всё с этого компьютера» — обещание, данное человеку в
 * диалоге выхода. Оно должно выполняться для ЛЮБОГО ключа с его данными, а не
 * для перечисленных заранее.
 *
 * Перечень стираемого не может быть полным по построению: он уже дважды
 * разошёлся с приложением — кэш портрета и кэш его разделов лежали под общими
 * ключами и переживали выход, а список про них не знал. Поэтому список
 * перевёрнут: перечисляются настройки устройства, стирается всё остальное.
 */

const UID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER = 'ffffffff-1111-4222-8333-444444444444';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('стирание при выходе не оставляет данных', () => {
  it('уносит ключи с личными данными, о которых список не знал', () => {
    // Ровно те ключи, что пережили выход в реальности.
    localStorage.setItem('ai_portrait_sections', 'разделы портрета');
    localStorage.setItem('activity_log_v1', '[{"message":"…"}]');
    localStorage.setItem('contact_doors_cache', 'наблюдение о том, как человек пишет');
    localStorage.setItem('ai_taxonomy', 'темы человека');
    localStorage.setItem('rerank_bench_state_v1', 'поисковые запросы человека');
    localStorage.setItem('jw_pending_theme_touches', '["local_1"]');
    localStorage.setItem('jw_guest_draft', 'недописанный текст');

    clearAccountScopedStorage(UID);

    for (const k of [
      'ai_portrait_sections', 'activity_log_v1', 'contact_doors_cache',
      'ai_taxonomy', 'rerank_bench_state_v1', 'jw_pending_theme_touches', 'jw_guest_draft',
    ]) {
      expect(localStorage.getItem(k), `${k} должен быть стёрт`).toBeNull();
    }
  });

  it('настройки устройства остаются: это не данные человека', () => {
    localStorage.setItem('app-theme', 'amethyst');
    localStorage.setItem('app_language', 'ru');
    localStorage.setItem('preview_width', '420');
    localStorage.setItem('onboarding_done', 'true');

    clearAccountScopedStorage(UID);

    expect(localStorage.getItem('app-theme')).toBe('amethyst');
    expect(localStorage.getItem('app_language')).toBe('ru');
    expect(localStorage.getItem('preview_width')).toBe('420');
    expect(localStorage.getItem('onboarding_done')).toBe('true');
  });

  /**
   * Второй человек этого браузера в диалоге выхода не участвовал: его сейф,
   * черновики и согласия трогать нельзя.
   */
  it('данные другого аккаунта не трогаются', () => {
    localStorage.setItem(`enc_enabled_${OTHER}`, '1');
    localStorage.setItem(`draft-${OTHER}`, 'чужой черновик');
    localStorage.setItem(`ai_user_portrait_${OTHER}`, 'чужой портрет');
    localStorage.setItem(`privacy_accepted_${OTHER}`, '1');

    localStorage.setItem(`enc_enabled_${UID}`, '1');
    localStorage.setItem(`ai_user_portrait_${UID}`, 'свой портрет');

    clearAccountScopedStorage(UID);

    expect(localStorage.getItem(`enc_enabled_${OTHER}`)).toBe('1');
    expect(localStorage.getItem(`draft-${OTHER}`)).toBe('чужой черновик');
    expect(localStorage.getItem(`ai_user_portrait_${OTHER}`)).toBe('чужой портрет');
    expect(localStorage.getItem(`privacy_accepted_${OTHER}`)).toBe('1');

    expect(localStorage.getItem(`enc_enabled_${UID}`)).toBeNull();
    expect(localStorage.getItem(`ai_user_portrait_${UID}`)).toBeNull();
  });

  it('LS-6: ключи с суффиксом guest / guest_ стираются при выходе «на чужом компьютере»', () => {
    localStorage.setItem('unlocked_achievements_guest', '["a1"]');
    localStorage.setItem('achievement_earned_at_guest', '{"a1": 123}');
    localStorage.setItem('ai_user_portrait_guest', 'гостевой портрет');
    localStorage.setItem('ai_taxonomy_guest', 'гостевые темы');
    localStorage.setItem('ai_judge_log_guest', 'гостевой лог судьи');
    localStorage.setItem('draft-guest_random123', 'гостевой черновик');

    clearAccountScopedStorage(UID);

    expect(localStorage.getItem('unlocked_achievements_guest')).toBeNull();
    expect(localStorage.getItem('achievement_earned_at_guest')).toBeNull();
    expect(localStorage.getItem('ai_user_portrait_guest')).toBeNull();
    expect(localStorage.getItem('ai_taxonomy_guest')).toBeNull();
    expect(localStorage.getItem('ai_judge_log_guest')).toBeNull();
    expect(localStorage.getItem('draft-guest_random123')).toBeNull();
  });
});
