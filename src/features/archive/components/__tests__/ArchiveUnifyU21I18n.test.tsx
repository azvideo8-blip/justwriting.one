// U-21 (решение владельца 2026-10-18): подписи и aria-имя группы значков копий на
// телефоне идут из i18n (`useLanguage`) и несут те же смыслы, что десктопный
// StorageButtons, — в том числе «не отправлено» и «скрыто от ИИ». Проверка на двух
// языках: RU и EN.
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LanguageProvider } from '../../../../shared/i18n';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { StorageStateIcons } from '../StorageStateIcons';

interface IconProps { cloud: boolean; device: boolean; analyzed: boolean; pendingSync?: boolean; excluded?: boolean }

function ariaLabelOf(props: IconProps, lang: 'ru' | 'en') {
  localStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, lang);
  try {
    const { container } = render(
      <LanguageProvider>
        <StorageStateIcons {...props} />
      </LanguageProvider>,
    );
    return container.querySelector('[data-storage-state]')!.getAttribute('aria-label')!;
  } finally {
    localStorage.removeItem(STORAGE_KEYS.APP_LANGUAGE);
  }
}

describe('U-21.3: подписи значков копий — RU и EN', () => {
  beforeEach(() => { cleanup(); });

  it('копия на устройстве — тот же смысл на обоих языках', () => {
    expect(ariaLabelOf({ cloud: false, device: true, analyzed: false }, 'ru')).toContain('на устройстве');
    expect(ariaLabelOf({ cloud: false, device: true, analyzed: false }, 'en')).toContain('on this device');
  });

  it('«не отправлено» — сигнал, который на телефоне терялся', () => {
    const ru = ariaLabelOf({ cloud: true, device: true, analyzed: false, pendingSync: true }, 'ru');
    expect(ru, 'русской подписи «не отправлено» нет').toContain('неотправленные');
    expect(ariaLabelOf({ cloud: true, device: true, analyzed: false, pendingSync: true }, 'en')).toContain('Unsent changes');
  });

  it('«скрыто от ИИ» — на обоих языках', () => {
    const hidden = { cloud: true, device: true, analyzed: false, excluded: true };
    expect(ariaLabelOf(hidden, 'ru')).toContain('Скрыто от ИИ');
    expect(ariaLabelOf(hidden, 'en')).toContain('Hidden from AI');
  });

  it('облако и разбор — как в подписях MF-14', () => {
    const all = { cloud: true, device: true, analyzed: true };
    const ru = ariaLabelOf(all, 'ru');
    expect(ru).toContain('В облаке');
    expect(ru).toContain('разобрано');
    const en = ariaLabelOf(all, 'en');
    expect(en).toContain('In the cloud');
    expect(en).toContain('analysed');
  });
});
