import { create } from 'zustand';
import { useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useLanguage } from '../../shared/i18n';
import { Button } from './Button';
import { useModalEscape } from '../hooks/useModalEscape';
import { useFocusTrap } from '../hooks/useFocusTrap';

// LX-3: Promise-based confirm/alert/prompt replacement for native dialogs.
// Usage: const { confirm, alert, prompt } = useConfirmDialog();
//   const ok = await confirm({ title: 'Delete?', message: 'Are you sure?' });
//   await alert({ title: 'Error', message: 'File too large' });
//   const text = await prompt({ title: 'Reason', placeholder: '...' });

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface AlertOptions {
  title: string;
  message?: string;
  okLabel?: string;
}

interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  okLabel?: string;
  cancelLabel?: string;
}

interface DialogState {
  isOpen: boolean;
  mode: 'confirm' | 'alert' | 'prompt';
  title: string;
  message: string;
  confirmLabel: string | undefined;
  cancelLabel: string | undefined;
  destructive: boolean;
  placeholder: string | undefined;
  inputValue: string;
  okLabel: string | undefined;
  resolve: ((value: boolean | string | null) => void) | null;
  resolveAs: 'boolean' | 'void' | 'string';
  openConfirm: (opts: ConfirmOptions) => Promise<boolean>;
  openAlert: (opts: AlertOptions) => Promise<void>;
  openPrompt: (opts: PromptOptions) => Promise<string | null>;
  setInputValue: (v: string) => void;
  handleConfirm: () => void;
  handleCancel: () => void;
}

const useDialogStore = create<DialogState>((set, get) => ({
  isOpen: false,
  mode: 'confirm',
  title: '',
  message: '',
  confirmLabel: undefined,
  cancelLabel: undefined,
  destructive: false,
  placeholder: undefined,
  inputValue: '',
  okLabel: undefined,
  resolve: null,
  resolveAs: 'boolean' as const,

  openConfirm(opts) {
    return new Promise<boolean>(resolve => {
      set({
        isOpen: true,
        mode: 'confirm',
        title: opts.title,
        message: opts.message ?? '',
        confirmLabel: opts.confirmLabel,
        cancelLabel: opts.cancelLabel,
        destructive: opts.destructive ?? true,
        resolveAs: 'boolean',
        resolve: resolve as (value: boolean | string | null) => void,
      });
    });
  },

  openAlert(opts) {
    return new Promise<void>(resolve => {
      set({
        isOpen: true,
        mode: 'alert',
        title: opts.title,
        message: opts.message ?? '',
        okLabel: opts.okLabel,
        resolveAs: 'void',
        resolve: (() => resolve()) as (value: boolean | string | null) => void,
      });
    });
  },

  openPrompt(opts) {
    return new Promise<string | null>(resolve => {
      set({
        isOpen: true,
        mode: 'prompt',
        title: opts.title,
        message: opts.message ?? '',
        placeholder: opts.placeholder,
        inputValue: opts.defaultValue ?? '',
        okLabel: opts.okLabel,
        cancelLabel: opts.cancelLabel,
        resolveAs: 'string',
        resolve: resolve as (value: boolean | string | null) => void,
      });
    });
  },

  setInputValue(v) {
    set({ inputValue: v });
  },

  handleConfirm() {
    const { resolve, mode, inputValue } = get();
    if (resolve) {
      if (mode === 'prompt') {
        resolve(inputValue);
      } else if (mode === 'alert') {
        resolve(true);
      } else {
        resolve(true);
      }
    }
    set({ isOpen: false, resolve: null });
  },

  handleCancel() {
    const { resolve, mode } = get();
    if (resolve) {
      if (mode === 'prompt') {
        resolve(null);
      } else {
        resolve(false);
      }
    }
    set({ isOpen: false, resolve: null });
  },
}));

export function useConfirmDialog() {
  const { openConfirm, openAlert, openPrompt } = useDialogStore();
  return { confirm: openConfirm, alert: openAlert, prompt: openPrompt };
}

export function ConfirmDialogRenderer() {
  const { t } = useLanguage();
  const {
    isOpen, mode, title, message, confirmLabel, cancelLabel, destructive,
    placeholder, inputValue, okLabel, setInputValue, handleConfirm, handleCancel,
  } = useDialogStore();
  const reducedMotion = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useModalEscape(isOpen, handleCancel);
  useFocusTrap(modalRef, isOpen);

  if (!isOpen) return null;

  const isPrompt = mode === 'prompt';
  const isAlert = mode === 'alert';

  return (
    <div className="fixed inset-0 z-[var(--z-critical)] flex items-center justify-center p-4 bg-surface-base/80 backdrop-blur-md">
      <motion.div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        initial={reducedMotion ? {} : { scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-sm rounded-2xl p-6 bg-surface-popup border border-border-subtle text-text-main shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="dialog-title" className="text-lg font-bold mb-2">{title}</div>
        {message && <p className="text-sm text-text-main/60 mb-4">{message}</p>}
        {isPrompt && (
          <input
            ref={inputRef}
            autoFocus
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
            placeholder={placeholder}
            className="w-full mb-4 px-3 py-2.5 rounded-xl bg-surface-base border border-border-subtle text-sm text-text-main outline-none focus:border-brand-soft/40"
          />
        )}
        <div className="flex gap-3">
          {!isAlert && (
            <Button
              type="button"
              onClick={handleCancel}
              className="flex-1 px-4 py-3 text-sm font-bold rounded-xl border border-border-subtle text-text-main hover:bg-white/5"
            >
              {cancelLabel || t('common_cancel')}
            </Button>
          )}
          <Button
            type="button"
            onClick={handleConfirm}
            className={isAlert
              ? "flex-1 px-4 py-3 text-sm font-bold rounded-xl bg-brand-soft text-white hover:bg-brand-soft/90"
              : destructive
                ? "flex-1 px-4 py-3 text-sm font-bold rounded-xl bg-accent-danger text-white hover:bg-accent-danger/90"
                : "flex-1 px-4 py-3 text-sm font-bold rounded-xl bg-brand-soft text-white hover:bg-brand-soft/90"}
          >
            {isAlert
              ? (okLabel || 'OK')
              : (confirmLabel || t('finish_discard'))}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
