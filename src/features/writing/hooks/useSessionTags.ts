import { useState } from 'react';
import { SessionService } from '../services/SessionService';

export function useSessionTags(sessionId: string, initialTags: string[] = []) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [loading, setLoading] = useState(false);

  const updateTags = async (newTags: string[]) => {
    setLoading(true);
    try {
      await SessionService.updateSessionTags(sessionId, newTags);
      setTags(newTags);
    } catch (error) {
      console.error('Error updating session tags:', error);
    } finally {
      setLoading(false);
    }
  };

  const addTag = (tag: string) => {
    if (tag && !tags.includes(tag)) {
      updateTags([...tags, tag]);
    }
  };

  const removeTag = (tag: string) => {
    updateTags(tags.filter(t => t !== tag));
  };

  return { tags, addTag, removeTag, loading };
}
