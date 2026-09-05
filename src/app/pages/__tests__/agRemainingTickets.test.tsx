import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { getLocalDb } from '../../../core/storage/localDb';
import { settingsTranslations } from '../../../shared/i18n/translations/settings';
import { profileTranslations } from '../../../shared/i18n/translations/profile';
import { commonTranslations } from '../../../shared/i18n/translations/common';

describe('LocalDocumentService.getDocumentsByOwner (REFUTED ticket alias)', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    await db.clear('documents');
  });

  it('getDocumentsByOwner returns documents owned by ownerId', async () => {
    const db = await getLocalDb();
    const doc1 = {
      id: 'doc-1',
      guestId: 'owner-xyz',
      title: 'Doc 1',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 60,
      sessionsCount: 1,
      createdAt: Date.now() - 1000,
      firstSessionAt: Date.now() - 1000,
      lastSessionAt: Date.now() - 500,
      tags: [],
    };
    const doc2 = {
      id: 'doc-2',
      guestId: 'owner-xyz',
      title: 'Doc 2',
      currentVersion: 1,
      totalWords: 100,
      totalDuration: 120,
      sessionsCount: 1,
      createdAt: Date.now() - 2000,
      firstSessionAt: Date.now() - 2000,
      lastSessionAt: Date.now(),
      tags: [],
    };
    const docOther = {
      id: 'doc-3',
      guestId: 'owner-other',
      title: 'Doc 3',
      currentVersion: 1,
      totalWords: 20,
      totalDuration: 30,
      sessionsCount: 1,
      createdAt: Date.now(),
      firstSessionAt: Date.now(),
      lastSessionAt: Date.now(),
      tags: [],
    };

    await db.put('documents', doc1);
    await db.put('documents', doc2);
    await db.put('documents', docOther);

    const docs = await LocalDocumentService.getDocumentsByOwner('owner-xyz');
    expect(docs).toHaveLength(2);
    expect(docs.map(d => d.id)).toEqual(['doc-2', 'doc-1']); // sorted by lastSessionAt desc
  });
});

describe('AG-I18N-1 & AG-I18N-2: Translations completeness', () => {
  it('defines all required keys with both ru and en locales', () => {
    const requiredKeys = [
      { dict: profileTranslations, key: 'profile_act_map' },
      { dict: profileTranslations, key: 'profile_rhythm' },
      { dict: profileTranslations, key: 'me_account_status' },
      { dict: profileTranslations, key: 'me_guest_desc' },
      { dict: commonTranslations, key: 'nav_login' },
      { dict: commonTranslations, key: 'nav_logout' },
      { dict: settingsTranslations, key: 'settings_more_options' },
      { dict: settingsTranslations, key: 'settings_open_panel' },
      { dict: settingsTranslations, key: 'settings_delete_account_password_prompt' },
      { dict: settingsTranslations, key: 'settings_delete_account_password_placeholder' },
      { dict: settingsTranslations, key: 'settings_delete_account_wrong_password' },
      { dict: settingsTranslations, key: 'settings_delete_account_progress' },
      { dict: settingsTranslations, key: 'settings_delete_account_confirm_button' },
    ];

    for (const { dict, key } of requiredKeys) {
      expect(dict[key], `Missing translation key: ${key}`).toBeDefined();
      expect(dict[key]?.ru, `Missing ru for key: ${key}`).toBeTruthy();
      expect(dict[key]?.en, `Missing en for key: ${key}`).toBeTruthy();
    }
  });
});
