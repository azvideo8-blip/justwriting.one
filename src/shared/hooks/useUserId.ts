import { useState } from 'react';
import { User } from 'firebase/auth';
import { getOrCreateGuestId } from '../../core/storage/localDb';

export function useUserId(user: User | null): string {
  const [guestId] = useState(() => getOrCreateGuestId());
  return user?.uid ?? guestId;
}
