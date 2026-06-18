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
}: FinishModalTagsProps) {
  const toggleTag = (tag: string) => {
    if (tags.includes(tag)) {
      setTags(tags.filter(t2 => t2 !== tag));
    } else {
      setTags([...tags, tag]);
    }
  };

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
            <span>{t('finish_title_label') || 'Title & Label'}</span>
            {formExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>

          {formExpanded && (
            <div className="p-4 space-y-4">
              <div className="space-y-1.5">
                <Input
                  type="text"
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
            <span>{t('finish_tags') || 'Tags'}</span>
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
