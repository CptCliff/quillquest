import type { Mail, Mailer } from './types';

/** Records what would have been sent. Tests and browser runs read `sent`. */
export class FakeMailer implements Mailer {
  readonly name = 'fake';
  sent: Mail[] = [];
  failNext = 0;
  async send(mail: Mail): Promise<void> {
    if (this.failNext > 0) { this.failNext--; throw new Error('mail service down'); }
    this.sent.push(mail);
  }
}

/** Prints mail to the console, for local development with no mail service. */
export class LogMailer implements Mailer {
  readonly name = 'log';
  async send(mail: Mail): Promise<void> {
    console.log(`[mail] to ${mail.to}: ${mail.subject}\n${mail.text}`);
  }
}
