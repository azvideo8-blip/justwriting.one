import { useCallback, useEffect, useMemo, useRef, useState, Fragment, type ReactNode } from 'react';
import { AlertTriangle, Check, Copy, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useLanguage } from '../../../shared/i18n';
import { Button } from '../../../shared/components/Button';
import { CheckboxRow } from '../../../shared/components/CheckboxRow';
import { Toggle } from '../../../shared/components/Toggle';
import { useToast } from '../../../shared/components/Toast';
import { copyRecoveryCode, downloadRecoveryCode } from '../../../shared/components/recoveryCodeActions';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { setRememberDevice } from '../../../core/crypto/useEncryptionStore';
import { clearDeviceKey } from '../../../core/crypto/keyVaultCache';
import { setCloudSyncEnabled } from '../../../core/sync/cloudSyncEnabled';
import { useEmptyDeviceDetection } from '../../../core/sync/useEmptyDeviceDetection';
import { SyncService } from '../../../core/services/SyncService';
import { reportError } from '../../../shared/errors/reportError';
import { getCurrentUser } from '../../../core/auth';
import { PrivacyConsentCheckboxes, PrivacyConsentText, savePrivacyConsent } from './PrivacyConsentBody';

/**
 * MC-6: три полноэкранных шага вместо стопа окон после входа по паролю.
 *
 * Это не новое согласие и не новая запись: шаги вызывают ровно те же функции,
 * что окна `PrivacyModal`, `RecoveryCodeGate` и `SyncConsentModal`, и пишут те
 * же версии и ключи. Юридический текст берётся из `PrivacyConsentText`, а не
 * перепечатывается.
 *
 * Экран не является окном: у него нет `role="dialog"`, поэтому нижняя панель и
 * фокус трапа окон здесь ни при чём (ср. читалку MP-1).
 */

export type FirstRunStepId = 'policy' | 'code' | 'cloud';

/** Место шага в очереди: «Шаг 2 из 3» обязан считать живые шаги, а не трое
 *  всегда, иначе из одного шага получается «Шаг 1 из 3». */
export interface StepPosition { index: number; total: number; }

function StepHeader({ index, total, title }: { index: number; total: number; title: string }) {
  const { t } = useLanguage();
  return (
    <header className="flex items-center gap-3 px-5 pt-5 pb-3">
      <h1 className="flex-1 min-w-0 text-[20px] leading-tight font-semibold text-[var(--text-main)]">{title}</h1>
      {/* MQ-13: «Шаг 1 из 1» — счётчик для одного шага лишний. */}
      {total > 1 && (
        <span data-testid="first-run-step" className="shrink-0 text-[13px] text-[var(--text-muted)]">
          {t('first_run_step', { current: String(index + 1), total: String(total) })}
        </span>
      )}
    </header>
  );
}

/**
 * Пуля шага 1. Содержимое — дословные предложения из `PrivacyConsentText`:
 * пересказывать юридический текст вторым экземпляром нельзя, два формата
 * разъезжаются при первой же правке (и раздувают index-кусок вдвое).
 */
function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3 text-[16px] leading-relaxed text-[var(--text-main)]">
      <span aria-hidden="true" className="mt-2.5 w-1.5 h-1.5 rounded-full bg-[var(--text-subtle)] shrink-0" />
      <span>{children}</span>
    </li>
  );
}

/** Шаг 1 — то же согласие, что `PrivacyModal`, крупнее и без gates прокрутки. */
export function FirstRunPolicyStep({ position, onNext }: { position: StepPosition; onNext: (aiConsent: boolean) => Promise<void> }) {
  const { t } = useLanguage();
  const [checked, setChecked] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const policyRef = useRef<HTMLDivElement>(null);

  // Ссылка живёт в подвале, а текст раскрывается в теле: показать его, не заставляя искать.
  useEffect(() => {
    if (policyOpen) policyRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [policyOpen]);

  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      await onNext(aiConsent);
    } catch (e) {
      reportError(e, { action: 'firstRunPolicyAccept' });
      setError(t('privacy_modal_save_error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <StepHeader index={position.index} total={position.total} title={t('first_run_policy_title')} />
      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-5">
        <ul className="space-y-3">
          <Bullet>
            {t('privacy_consent_storage_p1_before')}<strong>{t('privacy_consent_storage_p1_strong')}</strong>{t('privacy_consent_storage_p1_after')}
          </Bullet>
          <Bullet>
            {t('privacy_consent_third_party_p1_before')}<strong>{t('privacy_consent_third_party_p1_strong')}</strong>{t('privacy_consent_third_party_p1_after')}
          </Bullet>
          <Bullet>{t('privacy_consent_third_party_p3')}</Bullet>
          {/* Ревью 0.9.40: что запросы могут уйти поставщику за рубежом, окно
              согласия показывает сразу — здесь это тоже не прячется за ссылку. */}
          <Bullet>{t('privacy_consent_third_party_p2')}</Bullet>
        </ul>

        <Button
          variant="ghost"
          onClick={() => setPolicyOpen(v => !v)}
          aria-expanded={policyOpen}
          className="text-[15px] text-brand-soft underline underline-offset-2 px-0 min-h-11"
        >
          {t(policyOpen ? 'first_run_policy_link_close' : 'first_run_policy_link')}
        </Button>

        {policyOpen && (
          <div
            ref={policyRef}
            data-testid="first-run-policy-full"
            className="max-h-[45dvh] overflow-y-auto rounded-2xl border border-[var(--border-light)] bg-[var(--surface-card)] p-4"
          >
            <PrivacyConsentText />
          </div>
        )}

        {/* Необязательное ИИ-согласие — в теле: оно длинное, и в подвале на 360×640 съедало
            весь экран (живой снимок: тело 30 px из 640). Решение остаётся за человеком, галочка снята. */}
        <PrivacyConsentCheckboxes
          large
          show="ai"
          className="mt-2 border-t-0 pt-0"
          checked={checked}
          onChecked={setChecked}
          aiConsent={aiConsent}
          onAiConsent={setAiConsent}
        />

        {error !== null && <p className="text-[13px] text-accent-danger">{error}</p>}
      </div>

      {/* SA-2: обязательная галочка и кнопка — в подвале, не в конце прокрутки: на 360×640
          обязательная галочка стояла на 2,8 экрана ниже серой кнопки. Прокручивается текст. */}
      <footer data-testid="first-run-policy-footer" className="px-5 pt-1 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] border-t border-border-subtle/50">
        <PrivacyConsentCheckboxes
          large
          show="required"
          className="mt-0 border-t-0 pt-3"
          checked={checked}
          onChecked={setChecked}
          aiConsent={aiConsent}
          onAiConsent={setAiConsent}
        />

        <Button
          onClick={() => void accept()}
          disabled={!checked || saving}
          aria-describedby={checked ? undefined : 'first-run-consent-hint'}
          className="mt-3 w-full min-h-11 rounded-xl bg-brand-soft text-surface-base text-[16px] font-semibold disabled:opacity-40"
        >
          {t('privacy_modal_continue')}
        </Button>
        {/* Серая кнопка молча — не ответ: говорим, чего не хватает. */}
        {!checked && (
          <p id="first-run-consent-hint" data-testid="first-run-consent-hint" className="mt-2 text-center text-[13px] text-[var(--text-muted)]">
            {t('first_run_consent_hint')}
          </p>
        )}
      </footer>
    </>
  );
}

/** Шаг 2 — тот же код и те же действия, что в `RecoveryCodeDisplayModal`. */
export function FirstRunCodeStep({ position, code, onNext }: { position: StepPosition; code: string; onNext: (rememberDevice: boolean) => void }) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);

  const copy = async () => {
    if (await copyRecoveryCode(code)) {
      setCopied(true);
      showToast(t('enc_recovery_code_copied'), 'success');
      setTimeout(() => setCopied(false), 3000);
    } else {
      showToast(t('error_generic'), 'error');
    }
  };

  const download = () => {
    if (downloadRecoveryCode(code, t)) {
      showToast(t('enc_recovery_file_downloaded'), 'success');
    } else {
      showToast(t('error_generic'), 'error');
    }
  };

  return (
    <>
      <StepHeader index={position.index} total={position.total} title={t('enc_recovery_code_title')} />
      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-4">
        <p className="text-[15px] text-[var(--text-main)]">{t('enc_recovery_code_subtitle')}</p>

        <div className="flex gap-2.5 items-start rounded-xl bg-accent-warning/10 border border-accent-warning/20 text-accent-warning p-3">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span className="text-[13px] leading-relaxed">{t('enc_recovery_code_warning')}</span>
        </div>

        <div className="rounded-2xl border border-[var(--border-light)] bg-surface-base p-4 space-y-3">
          <div className="text-[13px] text-[var(--text-muted)]">{t('enc_recovery_code_label')}</div>
          {/* MQ-13: перенос только между группами — «…QZNC-» / «X9F0-N6ZE» посреди группы не рвётся. */}
          <div data-testid="first-run-code" className="font-mono text-[20px] leading-snug font-bold tracking-wider text-[var(--text-main)]">
            {code.split('-').map((group, i, all) => (
              <Fragment key={i}>
                <span className="whitespace-nowrap">{i < all.length - 1 ? `${group}-` : group}</span>
                {i < all.length - 1 && <wbr />}
              </Fragment>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void copy()} className="min-h-11 flex-1 whitespace-nowrap px-3 rounded-xl border border-[var(--border-light)] text-[15px] flex items-center justify-center gap-2">
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            {t(copied ? 'enc_recovery_code_copied_btn' : 'enc_recovery_code_copy_btn')}
          </Button>
          <Button onClick={download} className="min-h-11 flex-1 whitespace-nowrap px-3 rounded-xl border border-[var(--border-light)] text-[15px] flex items-center justify-center gap-2">
            <Download size={16} aria-hidden="true" />
            {t('enc_recovery_code_download_btn')}
          </Button>
        </div>

        {/* MQ-12 (N-3): строка целиком — цель касания 44 px, как у переключателя ниже. */}
        <CheckboxRow checked={confirmed} onChange={setConfirmed} labelClassName="text-[15px] text-[var(--text-main)]">
          {t('enc_recovery_code_confirm_checkbox')}
        </CheckboxRow>

        {/* MQ-12: строка целиком — label, подпись нажимается как сам переключатель. */}
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 pt-1">
          <span className="flex-1 min-w-0 text-[15px] text-[var(--text-main)]">{t('enc_recovery_remember_device')}</span>
          <Toggle checked={rememberDevice} onChange={setRememberDevice} ariaLabel={t('enc_recovery_remember_device')} />
        </label>
      </div>

      <footer className="px-5 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+20px)]">
        <Button
          onClick={() => onNext(rememberDevice)}
          disabled={!confirmed}
          aria-describedby={confirmed ? undefined : 'first-run-code-hint'}
          className="w-full min-h-11 rounded-xl bg-brand-soft text-surface-base text-[16px] font-semibold disabled:opacity-40"
        >
          {t('privacy_modal_continue')}
        </Button>
        {/* MQ-13: как на шаге 1 — серая кнопка не молчит. */}
        {!confirmed && (
          <p id="first-run-code-hint" data-testid="first-run-code-hint" className="mt-2 text-center text-[13px] text-[var(--text-muted)]">
            {t('first_run_code_hint')}
          </p>
        )}
      </footer>
    </>
  );
}

/** Шаг 3 — тот же выбор об облаке, что `SyncConsentModal`, плюс перенос
 *  вопроса о загрузке с другого устройства. */
export function FirstRunCloudStep({
  position,
  cloudCount,
  onFinish,
}: {
  position: StepPosition;
  cloudCount: number;
  onFinish: (syncOn: boolean, restoreWanted: boolean) => void;
}) {
  const { t, tp } = useLanguage();
  // MF-22 (SA-3, решение владельца «явно»): две равные кнопки, как десктопный
  // SyncConsentModal; ничего не выбрано заранее, «Пропустить» нет. Вопрос о
  // загрузке — только после «Включить облако» и только если в облаке что-то есть.
  const [askRestore, setAskRestore] = useState(false);
  const choice = 'w-full min-h-11 rounded-xl border border-[var(--border-light)] text-[16px] font-semibold text-[var(--text-main)]';

  return (
    <>
      <StepHeader index={position.index} total={position.total} title={t('first_run_cloud_title')} />
      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-5">
        <p className="text-[15px] leading-relaxed text-[var(--text-main)]">{t('sync_consent_body')}</p>
      </div>

      <footer className="px-5 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] space-y-2">
        {askRestore ? (
          <>
            <Button onClick={() => onFinish(true, true)} className={choice}>
              {tp('first_run_restore_switch', cloudCount)}
            </Button>
            <Button onClick={() => onFinish(true, false)} className={choice}>
              {t('first_run_restore_later')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => (cloudCount > 0 ? setAskRestore(true) : onFinish(true, false))} className={choice}>
              {t('first_run_cloud_on')}
            </Button>
            <Button onClick={() => onFinish(false, false)} className={choice}>
              {t('first_run_cloud_local')}
            </Button>
          </>
        )}
      </footer>
    </>
  );
}

interface FirstRunFlowProps {
  uid: string;
  showPrivacy: boolean;
  showConsent: boolean;
  onPrivacyDone: () => void;
  onConsentDone: () => void;
  /** Очередь за окнами `AppShell` обязана знать, что степпер что-то показывает:
   *  иначе код восстановления и предложение загрузить облако вылезут под ним. */
  onOpenChange: (open: boolean) => void;
}

/**
 * Очередь степпера: какие шаги нужны сейчас. Ответ на вопрос об облаке и код
 * восстановления читаются там же, где их читают окна-предшественники, — поэтому
 * «ничего не спрашивать повторно» работает одинаково для обеих поверхностей.
 */
export function FirstRunFlow({ uid, showPrivacy, showConsent, onPrivacyDone, onConsentDone, onOpenChange }: FirstRunFlowProps) {
  const navigate = useNavigate();
  const [codeTick, setCodeTick] = useState(0);
  const { shouldPrompt, cloudCount, dismiss: dismissRestore } = useEmptyDeviceDetection();

  // R3-2: код живёт в sessionStorage; перенос старой записи и чтение — те же,
  // что в `RecoveryCodeGate`, включая то, что значение считается на рендере, а
  // эффект лишь поднимает счётчик по событию (setState внутри эффекта здесь
  // устроил бы каскад перерисовок).
  useEffect(() => {
    const bump = () => setCodeTick(v => v + 1);
    window.addEventListener('pending_recovery_code_updated', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('pending_recovery_code_updated', bump);
      window.removeEventListener('storage', bump);
    };
  }, []);

  const readPendingCode = (): string | null => {
    const key = STORAGE_KEYS.PENDING_RECOVERY_CODE(uid);
    try {
      const legacy = localStorage.getItem(key);
      if (legacy) {
        sessionStorage.setItem(key, legacy);
        localStorage.removeItem(key);
      }
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const pendingCode = codeTick >= 0 ? readPendingCode() : null;

  // Ревью 0.9.40. Очередь — пройденные шаги плюс ещё нужные, в постоянном
  // порядке. Раньше шаг выпадал из списка, как только родитель снимал флаг
  // (`onPrivacyDone`), а индекс шёл вперёд — и код восстановления проскакивал.
  // Шаг «Облако» — только пока не задан вопрос о синхронизации: у ответивших
  // мастер выбор не трогает, а загрузку с другого устройства предлагает прежнее
  // окно — с прогрессом и сводкой. Мастер закрывается после последнего шага, и
  // это окно получает слово (раньше оно ждало закрытия мастера, а мастер —
  // загрузки: петля, из которой выпускало только «Пропустить»).
  const [done, setDone] = useState<FirstRunStepId[]>([]);
  const steps = useMemo<FirstRunStepId[]>(() => {
    const needed: Record<FirstRunStepId, boolean> = { policy: showPrivacy, code: pendingCode !== null, cloud: showConsent };
    return (['policy', 'code', 'cloud'] as const).filter(id => done.includes(id) || needed[id]);
  }, [showPrivacy, pendingCode, showConsent, done]);
  const step = steps.find(id => !done.includes(id));
  const open = step !== undefined;

  useEffect(() => { onOpenChange(open); }, [open, onOpenChange]);

  const finish = useCallback(() => { void navigate('/'); }, [navigate]);

  if (step === undefined) return null;

  const safeIndex = steps.indexOf(step);
  const advance = () => {
    const next = [...done, step];
    setDone(next);
    if (steps.every(id => next.includes(id))) finish();
  };

  if (step === 'policy') {
    return (
      <FirstRunStepper stepKey="policy">
        <FirstRunPolicyStep
          position={{ index: safeIndex, total: steps.length }}
          onNext={async (aiConsent) => {
            const user = getCurrentUser();
            if (user == null) return;
            await savePrivacyConsent(user.uid, aiConsent);
            onPrivacyDone();
            advance();
          }}
        />
      </FirstRunStepper>
    );
  }

  if (step === 'code' && pendingCode !== null) {
    return (
      <FirstRunStepper stepKey="code">
        <FirstRunCodeStep
          position={{ index: safeIndex, total: steps.length }}
          code={pendingCode}
          onNext={(rememberDevice) => {
            // Тот же путь, что `RecoveryCodeGate.handleConfirm`: снятый
            // переключатель забывает ключ устройства, код стирается всегда.
            if (!rememberDevice) {
              setRememberDevice(false);
              void clearDeviceKey(uid).catch(err =>
                reportError(err, { action: 'clearDeviceKey_uncheckRememberDevice', userId: uid }));
            }
            try {
              sessionStorage.removeItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(uid));
              localStorage.removeItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(uid));
            } catch { /* ignore */ }
            setCodeTick(v => v + 1);
            advance();
          }}
        />
      </FirstRunStepper>
    );
  }

  // Код пропал в другой вкладке, пока шаг ждал, — не показывать вместо него «Облако».
  if (step !== 'cloud') return null;

  return (
    <FirstRunStepper stepKey="cloud">
      <FirstRunCloudStep
        position={{ index: safeIndex, total: steps.length }}
        cloudCount={shouldPrompt ? cloudCount : 0}
        onFinish={(syncOn, restoreWanted) => {
          setCloudSyncEnabled(uid, syncOn);
          // Включение облака запускает незалитое — ровно как кнопка окна.
          if (syncOn) void SyncService.syncPending(uid).catch(e => reportError(e, { action: 'sync_pending_after_first_run' }));
          onConsentDone();
          // Загрузку с другого устройства делает окно-предшественник: у него
          // есть прогресс, сводка и восстановление ИИ-данных. Степпер только
          // решает, звать его или оставить вопрос закрытым.
          if (shouldPrompt && !restoreWanted) dismissRestore();
          advance();
        }}
      />
    </FirstRunStepper>
  );
}

/** not-a-modal: fullscreen first-run stepper */
function FirstRunStepper({ stepKey, children }: { stepKey: string; children: ReactNode }) {
  // SA-23 (O1): шаги сменяются со сдвигом 16 px и прозрачностью (220 мс вход, 150 мс уход) —
  // иначе «Шаг 2 из 3» читается как перезагрузка страницы. Reduced motion снимает сдвиг (MotionConfig).
  return (
    <div data-testid="first-run-stepper" className="fixed inset-0 z-[var(--z-critical)] flex flex-col bg-surface-base">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={stepKey}
          data-stepper-step={stepKey}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
