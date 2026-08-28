import { useState, useCallback } from 'react';

export function useSessionTags(initialTags: string[] = []) {
  const [tags, setTags] = useState<string[]>(initialTags);

  const updateTags = useCallback((newTags: string[]) => {
    setTags(newTags);
  }, []);

  const addTag = useCallback((tag: string) => {
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
  }, [tags]);

  const removeTag = useCallback((tag: string) => {
    setTags(tags.filter(t => t !== tag));
  }, [tags]);

  return { tags, addTag, removeTag, updateTags };
}
