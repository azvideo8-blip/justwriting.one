import { Sparkles, Shield, X, Check, Search } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { ModalShell } from '../../../shared/components/ModalShell';

interface IndexingConsentModalProps {
  isOpen: boolean;
  onConsent: () => void;
  onRefuse: () => void;
}

export function IndexingConsentModal({ isOpen, onConsent, onRefuse }: IndexingConsentModalProps) {
  if (!isOpen) return null;

  return (
    <ModalShell
      open={isOpen}
      onClose={onRefuse}
      labelId="indexing-consent-title"
      className="bg-surface-card border border-border-subtle rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-brand-soft" />
          <h3 id="indexing-consent-title" className="text-sm font-bold text-text-main">Поиск по смыслу (индексация)</h3>
        </div>
          <IconButton
            onClick={onRefuse}
            className="p-1.5 rounded-lg text-text-main/60 hover:text-text-main transition-colors"
            label="Закрыть"
            icon={<X size={18} />}
          />
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs text-text-main/80 leading-relaxed">
          <p>
            Чтобы искать заметки не только по точным совпадениям слов, но и по смыслу и ассоциациям, приложению требуется построить числовой индекс (эмбеддинги).
          </p>

          <div className="p-3 rounded-xl bg-surface-base/40 border border-border-subtle space-y-2">
            <div className="flex items-center gap-2 font-medium text-text-main">
              <Shield size={14} className="text-brand-soft" />
              <span>Что происходит с данными:</span>
            </div>
            <ul className="list-disc pl-4 space-y-1 text-text-main/70">
              <li>
                <strong>Что отправляется:</strong> Текст заметок отправляется частями модели эмбеддингов для построения смыслового поиска. Заметки с пометкой «не показывать ИИ» не индексируются.
              </li>
              <li>
                <strong>Когда отправляется:</strong> когда вы запускаете разбор заметки, и один раз по всему архиву в момент включения поиска по смыслу. Само по себе письмо и сохранение заметки ничего не отправляют.
              </li>
              <li>
                <strong>Что возвращается:</strong> Числовой вектор, который сохраняется в локальной базе устройства в зашифрованном виде.
              </li>
            </ul>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-accent-danger/5 border border-accent-danger/20 space-y-1.5">
              <div className="font-semibold text-accent-danger flex items-center gap-1.5">
                <X size={13} />
                <span>При отказе отключается:</span>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-text-main/60 text-[11px]">
                <li>Поиск по смыслу и блок связанных мыслей</li>
                <li>Автоматический подбор заметок в диалогах</li>
                <li>Грани личности в профиле</li>
                <li>Смысловые цепочки заметок (ветки)</li>
              </ul>
            </div>

            <div className="p-3 rounded-xl bg-accent-success/5 border border-accent-success/20 space-y-1.5">
              <div className="font-semibold text-accent-success flex items-center gap-1.5">
                <Check size={13} />
                <span>Продолжает работать:</span>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-text-main/60 text-[11px]">
                <li>Поиск по точным ключевым словам</li>
                <li>Ручной разбор отдельных заметок</li>
                <li>Хронология и журнал тем</li>
                <li>Обязательства и цели</li>
              </ul>
            </div>
          </div>

          <p className="text-text-main/50 text-[11px]">
            Выбор можно изменить в любой момент в настройках аккаунта.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 p-4 border-t border-border-subtle bg-surface-card/50">
          <Button
            onClick={onRefuse}
            className="flex-1 py-2.5 px-4 rounded-xl border border-border-subtle text-xs font-medium text-text-main/70 hover:bg-surface-base/50 transition-colors flex items-center justify-center gap-1.5"
          >
            <Search size={13} />
            Искать только по словам
          </Button>
          <Button
            onClick={onConsent}
            className="flex-1 py-2.5 px-4 rounded-xl bg-brand-soft text-surface-base text-xs font-medium hover:bg-brand-soft-hover transition-colors flex items-center justify-center gap-1.5 shadow-sm"
          >
            <Sparkles size={13} />
            Включить поиск по смыслу
          </Button>
        </div>
    </ModalShell>
  );
}
