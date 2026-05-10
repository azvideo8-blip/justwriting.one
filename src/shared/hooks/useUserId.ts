import { useMemo } from 'react';
import { User } from 'firebase/auth';
import { getOrCreateGuestId } from '../lib/localDb';

export function useUserId(user: User | null): string {
  return useMemo(() => user?.uid ?? getOrCreateGuestId(), [user?.uid]);
}
