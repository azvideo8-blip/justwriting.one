import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

/**
 * V-1.1: перезагрузка страницы посреди мастера приглашения не должна
 * выбрасывать человека обратно на «Добро пожаловать» — вместе с шагами терялись
 * галочки согласия (прод, memory f3-account-switch-findings). Храним шаги в
 * sessionStorage по хэшу токена из ссылки: другая ссылка — другая настройка.
 * Пароль сюда не пишется никогда.
 */
export type WizardStep = 'welcome' | 'policy' | 'password' | 'sync';
export type WizardSnapshot = { step: WizardStep; policy: boolean; aiConsent: boolean };

const STEPS: readonly WizardStep[] = ['welcome', 'policy', 'password', 'sync'];

export function loadWizardSnapshot(tokenHash: string | null): WizardSnapshot | null {
  if (!tokenHash) return null;
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(STORAGE_KEYS.INVITE_WIZARD_STATE(tokenHash)); } catch { return null; }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { step?: unknown; policy?: unknown; aiConsent?: unknown };
    if (!STEPS.includes(v.step as WizardStep)) return null;
    return { step: v.step as WizardStep, policy: Boolean(v.policy), aiConsent: Boolean(v.aiConsent) };
  } catch { return null; }
}

export function saveWizardSnapshot(tokenHash: string | null, snapshot: WizardSnapshot): void {
  if (!tokenHash) return;
  try { sessionStorage.setItem(STORAGE_KEYS.INVITE_WIZARD_STATE(tokenHash), JSON.stringify(snapshot)); } catch { /* приватный режим */ }
}

export function clearWizardSnapshot(tokenHash: string | null): void {
  if (!tokenHash) return;
  try { sessionStorage.removeItem(STORAGE_KEYS.INVITE_WIZARD_STATE(tokenHash)); } catch { /* приватный режим */ }
}
