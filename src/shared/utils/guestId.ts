const GUEST_ID_KEY = 'jw_guest_id';

function randomUUID(): string {
  return crypto.randomUUID();
}

export function getOrCreateGuestId(): string {
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    const saved = sessionStorage.getItem(GUEST_ID_KEY);
    if (saved) {
      id = saved;
      localStorage.setItem(GUEST_ID_KEY, id);
    }
  }
  if (!id) {
    id = `guest_${randomUUID()}`;
    localStorage.setItem(GUEST_ID_KEY, id);
  }
  sessionStorage.setItem(GUEST_ID_KEY, id);
  return id;
}
