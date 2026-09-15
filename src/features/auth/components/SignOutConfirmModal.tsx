import React, { useState, useEffect } from 'react';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { countLocalDataInventory, type LocalDataInventory } from '../services/localDataInventory';
import { ModalWrapper } from '../../../shared/components/ModalWrapper';
import { Button } from '../../../shared/components/Button';
import { LogOut, Trash2, AlertTriangle, ShieldCheck, Database, Loader2 } from 'lucide-react';

export interface SignOutConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (opts: { clearLocalData: boolean; force?: boolean }) => Promise<void>;
}

export function SignOutConfirmModal({ open, onClose, onConfirm }: SignOutConfirmModalProps) {
  const { user } = useAuthStatus();

  const [clearLocalData, setClearLocalData] = useState(false);
  const [inventory, setInventory] = useState<LocalDataInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [forceWipe, setForceWipe] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- НЕ производное: поля диалога пишет пользователь (галочки clearLocalData/forceWipe), здесь только сброс при открытии; плюс асинхронный подсчёт локальных данных за границей await
      setClearLocalData(false);
      setForceWipe(false);
      setErrorMsg(null);
      setLoading(true);
      void countLocalDataInventory(user?.uid).then((inv) => {
        setInventory(inv);
        setLoading(false);
      }).catch(() => {
        setLoading(false);
      });
    }
  }, [open, user]);

  const handleSignOut = async () => {
    setSigningOut(true);
    setErrorMsg(null);
    try {
      await onConfirm({ clearLocalData, force: forceWipe });
      onClose();
    } catch (err) {
      // AUD-11: очистка не удалась, но сам выход состоялся. Держать окно
      // открытым с кодом `LOCAL_WIPE_FAILED` в поле ошибки — сказать человеку
      // «выход не прошёл», хотя он прошёл. Объяснение уже ушло тостом.
      if ((err as { name?: string }).name === 'LocalWipeFailedError') {
        onClose();
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Unsynced') || msg.includes('несинхронизирован')) {
        setErrorMsg('Есть несинхронизированные данные. Подтвердите принудительное удаление или отмените выход.');
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <ModalWrapper
      isOpen={open}
      onClose={() => { if (!signingOut) onClose(); }}
      titleId="signout-modal-title"
      maxWidth="max-w-md"
    >
      <div className="space-y-4 p-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-surface-base text-text-main flex items-center justify-center border border-border-subtle shrink-0">
            <LogOut className="w-5 h-5" />
          </div>
          <div>
            <h2 id="signout-modal-title" className="text-base font-semibold text-text-main">
              Выход из аккаунта
            </h2>
          </div>
        </div>

        <div className="space-y-4">
          <label className="flex items-start gap-3 p-3 rounded-xl bg-surface-base/80 border border-border-subtle cursor-pointer transition-colors hover:border-border-subtle/80">
            <input
              type="checkbox"
              checked={clearLocalData}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setClearLocalData(e.target.checked);
                setErrorMsg(null);
              }}
              className="mt-0.5 rounded border-border-subtle text-accent focus:ring-accent"
            />
            <div className="space-y-1">
              <div className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5 text-text-muted" />
                Это чужой компьютер — удалить все данные
              </div>
              <div className="text-[11px] text-text-main/60 leading-relaxed">
                Полностью очистить браузерное хранилище (IndexedDB) на этом устройстве.
              </div>
            </div>
          </label>

          {!clearLocalData ? (
            <div className="p-3.5 rounded-xl bg-surface-base/50 border border-border-subtle/60 text-xs text-text-main/70 space-y-2">
              <div className="flex items-center gap-1.5 font-medium text-text-main">
                <ShieldCheck className="w-4 h-4 text-accent-success" />
                Локальные записи сохраняются
              </div>
              <p className="leading-relaxed text-[11px] text-text-main/60">
                Заметки останутся в браузере на этом устройстве. Ключ сейфа выгружен из памяти, сессия завершена. При следующем входе потребуется пароль для расшифровки.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-surface-base border border-border-subtle space-y-2 text-xs">
                <div className="flex items-center gap-1.5 font-medium text-text-main">
                  <Database className="w-4 h-4 text-accent-warning" />
                  Будет удалено с этого устройства:
                </div>
                {loading ? (
                  <div className="flex items-center gap-2 py-2 text-text-muted">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Подсчет локальных данных...
                  </div>
                ) : inventory ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-text-main/60 text-[11px] pt-1">
                    <div>Заметок: <strong className="text-text-main">{inventory.notesCount}</strong></div>
                    <div>Версий: <strong className="text-text-main">{inventory.versionsCount}</strong></div>
                    <div>Диалогов: <strong className="text-text-main">{inventory.dialoguesCount}</strong></div>
                    <div>Граней профиля: <strong className="text-text-main">{inventory.facetsCount}</strong></div>
                    <div>История жизни: <strong className="text-text-main">{inventory.lifeStoryCount}</strong></div>
                    <div>Реестр тем: <strong className="text-text-main">{inventory.themeCount}</strong></div>
                    <div>Убеждений: <strong className="text-text-main">{inventory.beliefsCount}</strong></div>
                    <div>Портрет: <strong className="text-text-main">{inventory.hasPortrait ? 'да' : 'нет'}</strong></div>
                  </div>
                ) : null}
              </div>

              {inventory && inventory.unsyncedNotesCount > 0 && (
                <div className="p-3 bg-accent-warning/10 border border-accent-warning/20 rounded-xl text-xs space-y-2">
                  <div className="flex items-center gap-1.5 font-medium text-accent-warning">
                    <AlertTriangle className="w-4 h-4" />
                    Внимание: несинхронизированные данные
                  </div>
                  <p className="text-text-main/70 text-[11px] leading-relaxed">
                    Найдено <strong>{inventory.unsyncedNotesCount}</strong> несинхронизированных правок. При удалении локальных данных они будут потеряны навсегда.
                  </p>
                  <label className="flex items-center gap-2 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={forceWipe}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForceWipe(e.target.checked)}
                      className="rounded border-border-subtle text-accent-warning"
                    />
                    <span className="text-[11px] text-accent-warning font-medium">
                      Я понимаю риски и хочу удалить данные без отправки в облако
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-accent-danger/10 border border-accent-danger/20 text-xs text-accent-danger flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {errorMsg}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-border-subtle">
          <Button onClick={onClose} disabled={signingOut} className="px-4 py-2 text-xs text-text-main/60 hover:text-text-main">
            Отмена
          </Button>
          <Button
            onClick={() => void handleSignOut()}
            disabled={signingOut || (clearLocalData && (inventory?.unsyncedNotesCount ?? 0) > 0 && !forceWipe)}
            className={`px-4 py-2 text-xs font-semibold flex items-center gap-1.5 ${
              clearLocalData
                ? 'bg-accent-danger/20 text-accent-danger border border-accent-danger/30 hover:bg-accent-danger/30'
                : 'border border-border-subtle bg-surface-base text-text-main hover:bg-surface-card'
            }`}
          >
            {signingOut ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LogOut className="w-3.5 h-3.5" />
            )}
            {clearLocalData ? 'Выйти и удалить всё' : 'Выйти'}
          </Button>
        </div>
      </div>
    </ModalWrapper>
  );
}
