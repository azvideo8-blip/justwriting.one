import React from 'react';
import { cn } from '../../../core/utils/utils';
import { SECTION_LABEL } from '../../../shared/components/ModalShell';
import { Toggle } from '../../../shared/components/Toggle';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';

export function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  // U-9 (решение владельца 2026-10-18): метка раздела — один вид на обоих
  // устройствах, SECTION_LABEL; на телефоне только крупнее (12 px вместо 10 px).
  const { layoutMode } = useLayoutMode();
  return (
    <div className="space-y-2">
      {/* Заголовок необязателен: на странице настроек его теперь рисует сама
          страница — с номером и пояснением. Раздел, рисующий свой заголовок
          внутри чужого, давал две одинаковые строки подряд. */}
      {title !== undefined && title !== '' && (
        <p className={cn('px-1', layoutMode === 'mobile' ? SECTION_LABEL : 'font-mono text-[10px] uppercase tracking-widest text-text-main/60')}>{title}</p>
      )}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function ToggleRow({ icon, label, hint, value, onChange }: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  value: boolean;
  onChange: () => void;
}) {
  // MQ-17: на телефоне описание — 13 px, а не .text-label (10 px, разрядка 0.08em):
  // многострочная проза разрядкой читается тяжело. U-3: цвет на обоих устройствах
  // один — `text-text-main/60`, как у второстепенного текста десктопа.
  const mobile = useLayoutMode().layoutMode === 'mobile';
  // D-4: переключатель — общий `Toggle`. Прежняя самописная дорожка ставила
  // белую ручку на белую же дорожку в тёмных темах — включённое состояние не
  // виделось. Общий контрол красится токенами (`bg-text-main` / `bg-surface-base`).
  // Строка — <label>: клик по любому её месту (и по отступам) нажимает
  // переключатель, а фокус и имя у строки одни — у самого `Toggle`.
  return (
    <label className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border-subtle px-4 py-3 transition-colors hover:bg-text-main/5">
      {Boolean(icon) && <span className="text-text-main/60 shrink-0">{icon}</span>}
      <span className="flex-1 text-left">
        <span className="text-sm text-text-main/70">{label}</span>
        {hint && <span className={cn('mt-0.5 block', mobile ? 'text-[13px] leading-snug text-text-main/60' : 'text-label text-text-main/60')}>{hint}</span>}
      </span>
      <Toggle checked={value} onChange={() => onChange()} ariaLabel={label} />
    </label>
  );
}
