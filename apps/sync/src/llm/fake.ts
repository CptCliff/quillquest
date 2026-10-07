import type { LlmProvider, LlmRequest } from './types';

/**
 * A deterministic stand-in for tests and browser runs: answers every request kind with valid JSON, records what it was sent (so tests can
 * check what a prompt contained), and lets a test queue an exact reply (for example a malformed one).
 */
export class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  calls: LlmRequest[] = [];
  private queued: (string | Error)[] = [];
  queue(...replies: (string | Error)[]) { this.queued.push(...replies); }

  async complete(req: LlmRequest): Promise<{ text: string }> {
    this.calls.push(req);
    const next = this.queued.shift();
    if (next instanceof Error) throw next;
    if (next !== undefined) return { text: next };
    return { text: answerFor(req.user) };
  }
}

function answerFor(user: string): string {
  if (user.startsWith('Which one of this character')) {
    const skills = /^Skills: (.*)$/m.exec(user)?.[1] ?? 'none';
    const first = skills === 'none' ? null : skills.split(', ')[0]!;
    return JSON.stringify({ skill: first });
  }
  if (user.startsWith('Give up to three ways')) return JSON.stringify({ prompts: ['The captain offers a deal that would cost an ally.', 'An old friend asks for the very thing the Belief forbids.'] });
  if (user.startsWith('Offer two or three sharper Dangers')) return JSON.stringify({ options: [{ danger: 'The ledger is stolen even if you get in.', rank: 'Serious' }, { danger: 'Someone sees who you are.', rank: 'Real' }] });
  if (user.startsWith('Write one short line of dialogue')) return JSON.stringify({ line: 'You should not be here, and you know it.' });
  if (user.startsWith('Choose the one of the campaign')) return JSON.stringify({ face: 2, tie: 'The rival is waiting in the next room.' });
  if (user.startsWith('Read this Life Chapter')) return JSON.stringify({ skills: ['Siegecraft', 'Endure'], traits: ['Sleeps Lightly', 'Counts Every Exit'] });
  if (user.startsWith('A Belief should hold')) return JSON.stringify({ conviction: true, action: false, fix: 'Add what you will do about it.' });
  return '{}';
}
