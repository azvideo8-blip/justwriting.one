import { useState } from 'react';
import { reportError } from '../../../shared/errors/reportError';

export function useSessionTags(initialTags: string[] = []) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [loading, setLoading] = useState(false);

  const updateTags = async (newTags: string[]) => {
    setLoading(true);
    try {
      setTags(newTags);
    } catch (error) {
      reportError(error, { action: 'update_session_tags' });
    } finally {
      setLoading(false);
    }
  };

  const addTag = (tag: string) => {
    if (tag && !tags.includes(tag)) {
      void updateTags([...tags, tag]);
    }
  };

  const removeTag = (tag: string) => {
    void updateTags(tags.filter(t => t !== tag));
  };

  return { tags, addTag, removeTag, loading };
}
