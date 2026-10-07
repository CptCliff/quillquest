import { authenticate } from '../auth';
import { AuthError, type AuthProvider, type Claims } from './types';

/** The signed dev token behind `/api/dev-token`. Mounted only with QUILLQUEST_DEV_AUTH=1, never in production. */
export class DevProvider implements AuthProvider {
  readonly name = 'dev';
  constructor(private secret: string) {}
  async verify(token: string): Promise<Claims> {
    try {
      const id = authenticate(token, this.secret);
      return { userId: id.id, name: id.name, color: id.color, role: id.role };
    } catch (e) {
      throw new AuthError(e instanceof Error ? e.message : 'invalid dev token');
    }
  }
}
