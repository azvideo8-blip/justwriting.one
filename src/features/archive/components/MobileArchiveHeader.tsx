import { MoreHorizontal } from 'lucide-react';
import type { RefObject } from 'react';
import { IconButton } from '../../../shared/components/IconButton';
import { Input } from '../../../shared/components/Input';
import { useLanguage } from '../../../shared/i18n';

interface MobileArchiveHeaderProps {
  title: string;
  count: number;
  countLabel: string;
  searchQuery: string;
  /** Владелец 27.10: поле видно, только если включено в листе «⋯». */
  searchVisible: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSearchChange: (q: string) => void;
  onOpenMenu: () => void;
  allTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
}

/**
 * MR-8: на телефоне в шапке архива остаются только заголовок, одно поле поиска и
 * «⋯». Десять контролов десктопной шапки (переключатель Заметки/Корзина,
 * подзаголовок, бейдж ⌘K, Список/Сетка, сортировка, теги, фильтры) свёрнуты в
 * лист: первая строка заметки начиналась с y ≈ 600 из 844.
 */
export function MobileArchiveHeader({
  title, count, countLabel, searchQuery, searchVisible, searchInputRef, onSearchChange, onOpenMenu,
  allTags, selectedTags, onToggleTag,
}: MobileArchiveHeaderProps) {
  const { t } = useLanguage();
  const q = searchQuery.trim().toLowerCase();
  // Чипсы под полем: подходящие по вводу теги плюс уже выбранные, чтобы сменить
  // фильтр можно было тапом, а не через «⋯».
  const chips = allTags.filter(tag => (q ? tag.toLowerCase().includes(q) : false) || selectedTags.includes(tag)).slice(0, 12);
  return (
    <div className="shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 min-w-0 text-[24px] font-medium tracking-tight text-text-main truncate">{title}</h1>
        <span className="text-[13px] font-medium text-text-main/60 tabular-nums shrink-0">{count} {countLabel}</span>
        <IconButton
          onClick={onOpenMenu}
          label={t('archive_more')}
          className="w-11 h-11 shrink-0"
          icon={<MoreHorizontal size={16} />}
        />
      </div>
      {searchVisible && <Input
        ref={searchInputRef}
        type="search"
        value={searchQuery}
        onChange={e => onSearchChange(e.target.value)}
        placeholder={t('archive_search_placeholder')}
        aria-label={t('archive_search_placeholder')}
        className="mt-2 h-11 bg-surface-card text-[16px]"
      />}
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {chips.map(tag => {
            const active = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleTag(tag)}
                aria-pressed={active}
                className={`min-h-11 px-3 rounded-full border text-[13px] font-mono ${active ? 'border-brand-soft/40 bg-brand-soft/15 text-brand-soft' : 'border-border-subtle text-text-main/70'}`}
              >
                #{tag}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
