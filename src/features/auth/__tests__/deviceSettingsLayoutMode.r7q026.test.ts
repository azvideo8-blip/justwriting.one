import { describe, it, expect, beforeEach } from 'vitest';
import { clearAccountScopedStorage } from '../services/accountScopedKeys';

// R7Q-026: список настроек устройства перечислен перевёрнутым списком — он
// называет мёртвые поколения `layout-mode` и `layout-mode-v3` и молчит про
// живое `layout-mode-v4`. Подметание при выходе («всё, что не объявлено
// настройкой устройства и не принадлежит другому аккаунту, — данные этого
// человека») сносило текущий выбор макета: человек на своём компьютере после
// выхода другого аккаунта терял режим, который выбирал сам. Персональных
// данных тут нет, но обещание «стираются только твои данные» нарушалось.

const UID = 'uid-owner';

describe('R7Q-026: живой ключ макета — настройка устройства, а не данные аккаунта', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('выход не трогает выбранный макет, тему и язык', () => {
    localStorage.setItem('layout-mode-v4', '"desktop"');
    localStorage.setItem('layout-mode-v3', '"mobile"');
    localStorage.setItem('layout-mode', '"mobile"');
    localStorage.setItem('app-theme', 'theme-notion');
    localStorage.setItem('justwriting_language', 'ru');
    localStorage.setItem(`ai_user_portrait_${UID}`, 'спецкатегории');

    clearAccountScopedStorage(UID);

    expect(localStorage.getItem('layout-mode-v4'), 'живой выбор макета обязан пережить выход').toBe('"desktop"');
    expect(localStorage.getItem('layout-mode-v3')).toBe('"mobile"');
    expect(localStorage.getItem('app-theme')).toBe('theme-notion');
    expect(localStorage.getItem(`ai_user_portrait_${UID}`), 'кэш портрета стереть обязан').toBeNull();
  });

  it('перевёрнутый список не дырявый: чужой аккаунт и не-объявленный ключ судьбу решают по-прежнему', () => {
    localStorage.setItem(`ai_user_portrait_${UID}`, 'своё');
    localStorage.setItem('ai_user_portrait_uid-other', 'чужое');
    localStorage.setItem('some_new_random_key', 'данные');

    clearAccountScopedStorage(UID);

    expect(localStorage.getItem(`ai_user_portrait_${UID}`)).toBeNull();
    expect(localStorage.getItem('ai_user_portrait_uid-other'), 'ключ чужого аккаунта не трогается').toBe('чужое');
    expect(localStorage.getItem('some_new_random_key'), 'необъявленный ключ — данные человека, подметается').toBeNull();
  });
});
