import { MailError, type Mail, type Mailer } from './types';

/** Resend's HTTP API by plain `fetch` (also fits Postmark-style APIs with a small change). No SDK to install. */
export class ResendMailer implements Mailer {
  readonly name = 'resend';
  constructor(private o: { apiKey: string; from: string; baseUrl?: string; timeoutMs?: number }) {}

  async send(mail: Mail): Promise<void> {
    const res = await fetch(`${this.o.baseUrl ?? 'https://api.resend.com'}/emails`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.apiKey}` },
      body: JSON.stringify({ from: this.o.from, to: [mail.to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 15_000),
    }).catch((e: unknown) => { throw new MailError(`Could not reach the mail service: ${e instanceof Error ? e.message : 'network error'}`); });
    if (!res.ok) throw new MailError(`The mail service refused the message (${res.status})`, res.status);
  }
}
