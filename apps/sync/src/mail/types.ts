/**
 * What the server needs from an email service. Providers are swappable (QUILLQUEST_MAIL; see docs/mail-providers.md).
 * Addresses come from sign-in, never from a client request, so nobody can aim the server's mail at a stranger.
 */
export interface Mail { to: string; subject: string; text: string }
export interface Mailer {
  readonly name: string;
  send(mail: Mail): Promise<void>;
}
export class MailError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'MailError';
  }
}
