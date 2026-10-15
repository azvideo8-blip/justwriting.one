import { ChevronRight } from 'lucide-react';
import { ModalShell } from '../../../../shared/components/ModalShell';
import { useLanguage } from '../../../../shared/i18n';
import { personaVisual } from '../../constants/personaVisuals';
import type { AIChatHeaderPersona } from './AIChatHeader';

export interface MobilePersonaSheetProps {
  open: boolean;
  onClose: () => void;
  personas: AIChatHeaderPersona[];
  selectedPersonaId: string;
  onSelect: (id: string) => void;
  onDetail: (persona: AIChatHeaderPersona) => void;
  onCreate: () => void;
}

/**
 * MR-3: выбор собеседника на телефоне. Раньше было два контроля — ряд чипов и
 * выпадающий список в шапке; теперь один лист, где строка в 48 px и есть выбор.
 */
export function MobilePersonaSheet(props: MobilePersonaSheetProps) {
  const { open, onClose, personas, selectedPersonaId, onSelect, onDetail, onCreate } = props;
  const { t, language } = useLanguage();
  const titleId = 'mobile-persona-sheet-title';

  return (
    <ModalShell open={open} onClose={onClose} labelId={titleId} variant="sheet">
      <div className="flex flex-col min-h-0 flex-1">
        <h2 id={titleId} className="px-4 pt-4 pb-2 text-base font-bold text-text-main">{t('ai_persona_sheet_title')}</h2>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          {personas.map(p => {
            const v = personaVisual(p.id, p.name);
            const on = selectedPersonaId === p.id;
            const role = language === 'en' ? v.role.en : v.role.ru;
            return (
              <div key={p.id} className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="persona-row"
                  onClick={() => { onSelect(p.id); onClose(); }}
                  className="flex-1 min-w-0 h-12 flex items-center gap-3 px-3 rounded-xl text-left"
                  style={on ? { background: `${v.color}1a` } : undefined}
                >
                  <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: v.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-text-main truncate">{p.name}</span>
                    <span className="block text-[13px] text-text-muted truncate">{role}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDetail(p)}
                  aria-label={t('ai_persona_detail')}
                  className="shrink-0 w-11 h-12 flex items-center justify-center text-text-main/45"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => { onCreate(); onClose(); }}
            className="w-full h-12 flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-text-main/80 border-t border-border-subtle mt-1"
          >
            {t('ai_persona_create_row')}
          </button>
        </div>
        <p className="px-4 py-3 text-[13px] text-text-muted border-t border-border-subtle">{t('ai_persona_sheet_footer')}</p>
      </div>
    </ModalShell>
  );
}
