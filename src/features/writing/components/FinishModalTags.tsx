import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { Label } from '../../../types';
import { Button } from '../../../shared/components/Button';
import { Input } from '../../../shared/components/Input';

interface FinishModalTagsProps {
  tags: string[];
  setTags: (tags: string[]) => void;
  allSuggestions: string[];
  labelId?: string | undefined;
  setLabelId: (id?: string) => void;
  labels: Label[];
  tagInputRef: React.RefObject<HTMLInputElement | null>;
  t: (k: string) => string;
  isMobile: boolean;
  tagsExpanded: boolean;
  setTagsExpanded: (v: boolean) => void;
  formExpanded: boolean;
  setFormExpanded: (v: boolean) => void;
  titleInputValue: string;
  setEditTitle: (v: string) => void;
  /** MC-3: на телефоне «Записано.» — три обычные строки без карточек и без
   *  раскрытия; `card` — прежний вид. */
  layout?: 'card' | 'plain';
  /** MC-3 T5: подсказка в поле названия — первые слова самого текста. */
  titlePlaceholder?: string;
}

export function FinishModalTags({
  tags,
  setTags,
  allSuggestions,
  labelId,
  setLabelId,
  labels,
  tagInputRef,
  t,
  isMobile,
  tagsExpanded,
  setTagsExpanded,
  formExpanded,
  setFormExpanded,
  titleInputValue,
  setEditTitle,
  layout = 'card',
  titlePlaceholder,
}: FinishModalTagsProps) {
  const toggleTag = (tag: string) => {
    if (tags.includes(tag)) {
      setTags(tags.filter(t2 => t2 !== tag));
    } else {
      setTags([...tags, tag]);
    }
  };
  const titleHint = titlePlaceholder || t('editor_title_placeholder');

  const addTagInput = (className: string) => (
    <Input
      ref={tagInputRef}
      type="text"
      aria-label={t('finish_add_tag')}
      placeholder={t('finish_add_tag')}
      className={className}
      onBlur={(e) => {
        const val = e.currentTarget.value.trim();
        if (val && !tags.includes(val)) {
          setTags([...tags, val]);
          e.currentTarget.value = '';
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const val = e.currentTarget.value.trim();
          if (val && !tags.includes(val)) {
            setTags([...tags, val]);
            e.currentTarget.value = '';
          }
          e.preventDefault();
        }
      }}
    />
  );

  // MC-3: те же контролы, что и в карточках, но тремя строками: название, метка,
  // теги. Никаких раскрывающихся шапок — в листе они только множат контролы.
  if (isMobile && layout === 'plain') {
    return (
      <div className="space-y-5">
        <div className="space-y-1.5">
          <div className="text-[13px] font-semibold uppercase tracking-wider text-text-subtle">{t('finish_title_label')}</div>
          <Input
            type="text"
            aria-label={t('finish_title_label')}
            value={titleInputValue}
            onChange={e => setEditTitle(e.target.value)}
            placeholder={titleHint}
            maxLength={200}
            className="min-h-11 rounded-xl border border-border-subtle bg-transparent px-3 text-[16px] text-text-main outline-none placeholder:text-text-subtle focus:border-text-main/40"
          />
        </div>

        {labels.length > 0 && (
          <div className="space-y-2">
            <div className="text-[13px] font-semibold uppercase tracking-wider text-text-subtle">{t('finish_labels')}</div>
            <div className="flex flex-wrap gap-2">
              {labels.map(label => (
                <Button
                  type="button"
                  key={label.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => setLabelId(labelId === label.id ? undefined : label.id)}
                  aria-pressed={labelId === label.id}
                  className={cn(
                    'min-h-11 gap-2 rounded-full border px-3 text-[14px] font-medium',
                    labelId === label.id ? 'border-text-main/40 text-text-main' : 'border-border-subtle text-text-main/60',
                  )}
                  style={{ backgroundColor: labelId === label.id ? `${label.color}22` : undefined }}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                  {label.name}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-[13px] font-semibold uppercase tracking-wider text-text-subtle">{t('finish_tags')}</div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Лист держит бюджет контролов (MC-3 ≤ 14): подсказок не больше
                трёх, остальное человек допишет сам в поле ниже. */}
            {allSuggestions.slice(0, 3).map(tag => (
              <Button
                type="button"
                key={tag}
                variant="ghost"
                size="sm"
                onClick={() => toggleTag(tag)}
                aria-pressed={tags.includes(tag)}
                className={cn(
                  'min-h-11 rounded-full border px-3 text-[14px] font-medium',
                  tags.includes(tag)
                    ? 'border-text-main/40 bg-text-main/10 text-text-main'
                    : 'border-border-subtle text-text-main/60',
                )}
              >
                #{tag}
              </Button>
            ))}
          </div>
          {addTagInput('min-h-11 rounded-xl border border-border-subtle bg-transparent px-3 text-[15px] text-text-main outline-none placeholder:text-text-subtle focus:border-text-main/40')}
        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <>
        <div className="border border-border-subtle rounded-2xl overflow-hidden bg-surface-base/10">
          <Button
            variant="ghost"
            size="md"
            onClick={() => setFormExpanded(!formExpanded)}
            className="w-full px-4 py-3 flex items-center justify-between bg-surface-base/20 hover:bg-surface-base/30 font-semibold text-sm"
          >
            <span>{t('finish_title_label')}</span>
            {formExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>

          {formExpanded && (
            <div className="p-4 space-y-4">
              <div className="space-y-1.5">
                <Input
                  type="text"
                  aria-label={t('finish_title_label')}
                  value={titleInputValue}
                  onChange={e => setEditTitle(e.target.value)}
                  placeholder={t('editor_title_placeholder')}
                  maxLength={200}
                  className="px-4 py-3 rounded-xl border outline-none transition-colors bg-surface-base border-border-subtle text-text-main text-base font-medium placeholder:text-text-main/40 focus:border-text-main/40 min-h-[44px]"
                />
              </div>

              {labels.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-text-main/60">{t('finish_labels')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {labels.map(label => (
                      <Button
                        type="button"
                        key={label.id}
                        variant="ghost"
                        size="sm"
                        onClick={() => setLabelId(labelId === label.id ? undefined : label.id)}
                        className={cn(
                          "px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 min-h-[40px]",
                          labelId === label.id
                            ? "border-2 border-white scale-105 opacity-100 shadow-lg"
                            : labelId !== undefined
                              ? "opacity-55 hover:opacity-85 border border-transparent"
                              : "hover:opacity-100 border border-transparent"
                        )}
                        style={{ backgroundColor: label.color }}
                      >
                        {label.name}
                      </Button>
                    ))}
                  </div>
                  {labels.some(l => l.name === '…') && (
                    <div className="text-xs text-text-main/60">{t('archive_labels_vault_locked')}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border border-border-subtle rounded-2xl overflow-hidden bg-surface-base/10">
          <Button
            variant="ghost"
            size="md"
            onClick={() => setTagsExpanded(!tagsExpanded)}
            className="w-full px-4 py-3 flex items-center justify-between bg-surface-base/20 hover:bg-surface-base/30 font-semibold text-sm"
          >
            <span>{t('finish_tags')}</span>
            {tagsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>

          {tagsExpanded && (
            <div className="p-4 space-y-4">
              {allSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {allSuggestions.map(tag => (
                    <Button
                      type="button"
                      key={tag}
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-h-[36px]",
                        tags.includes(tag)
                          ? "bg-text-main text-surface-base"
                          : "bg-surface-base text-text-main/70 hover:bg-text-main/10"
                      )}
                    >
                      #{tag}
                    </Button>
                  ))}
                </div>
              )}
              <Input
                ref={tagInputRef}
                type="text"
                aria-label={t('finish_add_tag')}
                placeholder={t('finish_add_tag')}
                className="px-4 py-2 rounded-xl border outline-none transition-colors bg-surface-base border-border-subtle text-text-main text-sm placeholder:text-text-main/60 focus:border-text-main/40 min-h-[44px]"
                onBlur={(e) => {
                  const val = e.currentTarget.value.trim();
                  if (val && !tags.includes(val)) {
                    setTags([...tags, val]);
                    e.currentTarget.value = '';
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = e.currentTarget.value.trim();
                    if (val && !tags.includes(val)) {
                      setTags([...tags, val]);
                      e.currentTarget.value = '';
                    }
                    e.preventDefault();
                  }
                }}
              />
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-text-main/60">
          {t('finish_title_label')}
        </div>
        <Input
          type="text"
          aria-label={t('finish_title_label')}
          value={titleInputValue}
          onChange={e => setEditTitle(e.target.value)}
          placeholder={t('editor_title_placeholder')}
          maxLength={200}
          className="px-4 py-3 rounded-2xl border outline-none transition-colors bg-surface-base border-border-subtle text-text-main text-lg font-medium placeholder:text-text-main/40 focus:border-text-main/40"
          autoFocus
        />
      </div>

      {labels.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-text-main/60">{t('finish_labels')}</div>
          <div className="flex flex-wrap gap-2">
            {labels.map(label => (
              <Button
                type="button"
                key={label.id}
                variant="ghost"
                size="sm"
                onClick={() => setLabelId(labelId === label.id ? undefined : label.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
                  labelId === label.id
                    ? "border-2 border-white scale-105 opacity-100 shadow-lg"
                    : labelId !== undefined
                      ? "opacity-55 hover:opacity-85 border border-transparent"
                      : "hover:opacity-100 border border-transparent"
                )}
                style={{ backgroundColor: label.color }}
              >
                {label.name}
              </Button>
            ))}
          </div>
          {labels.some(l => l.name === '…') && (
            <div className="text-xs text-text-main/60">{t('archive_labels_vault_locked')}</div>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-text-main/60">{t('finish_tags')}</div>
        <div className="flex flex-wrap gap-2">
          {allSuggestions.map(tag => (
            <Button
              type="button"
              key={tag}
              variant="ghost"
              size="sm"
              onClick={() => toggleTag(tag)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                tags.includes(tag)
                  ? "bg-text-main text-surface-base"
                  : "bg-surface-base text-text-main/70 hover:bg-text-main/10"
              )}
            >
              #{tag}
            </Button>
          ))}
        </div>
        <Input
          ref={tagInputRef}
          type="text"
          aria-label={t('finish_add_tag')}
          placeholder={t('finish_add_tag')}
          className="px-4 py-2 rounded-2xl border outline-none transition-colors bg-surface-base border-border-subtle text-text-main placeholder:text-text-main/60 focus:border-text-main/40"
          onBlur={(e) => {
            const val = e.currentTarget.value.trim();
                  if (val && !tags.includes(val)) {
                    setTags([...tags, val]);
                    e.currentTarget.value = '';
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = e.currentTarget.value.trim();
                    if (val && !tags.includes(val)) {
                      setTags([...tags, val]);
                      e.currentTarget.value = '';
                    }
                    e.preventDefault();
                  }
                }}
        />
      </div>
    </>
  );
}
