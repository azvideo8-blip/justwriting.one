export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  /** Когда аккаунт создан и когда был вход. Строки ISO либо null. */
  metadata: { creationTime: string | null; lastSignInTime: string | null };
}
