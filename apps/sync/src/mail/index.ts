import { FakeMailer, LogMailer } from './fake';
import { ResendMailer } from './resend';
import type { Mailer } from './types';

export * from './types';
export { FakeMailer, LogMailer, ResendMailer };

/** Chooses the mailer from the operator's environment. Unset means "not configured": nothing is emailed and the rest of the game is unchanged. */
export function mailerFromEnv(env: Record<string, string | undefined>, production: boolean): Mailer | null {
  const which = env.QUILLQUEST_MAIL;
  if (!which || which === 'none') return null;
  if (which === 'fake' || which === 'log') {
    if (production) throw new Error(`QUILLQUEST_MAIL=${which} must not be used in production`);
    return which === 'fake' ? new FakeMailer() : new LogMailer();
  }
  if (which === 'resend') {
    const need = (k: string) => env[k] || (() => { throw new Error(`${k} is required for QUILLQUEST_MAIL=resend`); })();
    return new ResendMailer({ apiKey: need('RESEND_API_KEY'), from: need('QUILLQUEST_MAIL_FROM'), baseUrl: env.QUILLQUEST_MAIL_URL });
  }
  throw new Error(`Unknown QUILLQUEST_MAIL: ${which} (resend, log, fake, none)`);
}
