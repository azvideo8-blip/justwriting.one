import { useState } from 'react';
import { getOrCreateGuestId } from '../utils/guestId';

export function useUserId(user: { uid: string } | null | undefined): string {
  const [guestId] = useState(() => getOrCreateGuestId());
  return user?.uid ?? guestId;
}
