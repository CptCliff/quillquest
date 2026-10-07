/** Who a token says the caller is. Authorization (what they may do in a campaign) comes from the directory, not from here. */
export interface Claims {
  userId: string;
  email?: string;
  /** Dev tokens only: a display name and ink to start a profile with. Never trusted for authorization. */
  name?: string;
  color?: string;
  /** Dev tokens only, used by the static directory in tests. A database directory ignores it. */
  role?: 'player' | 'gm';
}

export interface AuthProvider {
  readonly name: string;
  /** Resolves to the caller's identity, or rejects. */
  verify(token: string): Promise<Claims>;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
