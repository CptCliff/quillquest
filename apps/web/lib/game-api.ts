import type { Character, ConcessionKind, DiceView, OutcomePrompt, PublicCard } from '@quillquest/rules';

export type LedgerCard = PublicCard & { seq: number };

export class ApiFailure extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

export interface Preview {
  problems: string[];
  odds: { goal: string; danger: string } | null;
  candidates: { key: string; label: string }[];
}
export interface PromptInfo {
  prompt: OutcomePrompt | null;
  push: { available: boolean; standard: boolean; conviction: boolean };
}
export type CardPatchBody = Partial<{
  want: string; risk: string; onTheLine: string | null; backingBeliefId: string | null; dangerTargetId: string | null;
  difficulty: string | null; danger: string | null; dangerText: string; dangerKind: 'wound' | 'other'; declaredMortal: boolean;
  threat: string | null; shiftKeys: string[]; manualShifts: { ladder: string; delta: 1 | -1; source: string; reason: string }[];
  skillName: string; gmMarkedBig: boolean;
}>;

/** The game API, reached through the Next rewrite. The dev token is the bearer; the server reads the role from it. */
export class GameApi {
  constructor(private campaign: string, private token: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`/api/campaigns/${encodeURIComponent(this.campaign)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ApiFailure(json?.error?.message ?? 'Something went wrong', json?.error?.code ?? 'ERROR');
    return json as T;
  }

  me = () => this.call<{ character: Character | null }>('GET', '/me');
  createCard = (input: { skillName: string; anchorParagraphId?: string | null; want?: string; risk?: string }) =>
    this.call<{ card: PublicCard }>('POST', '/cards', input);
  edit = (id: string, patch: CardPatchBody) => this.call<{ card: PublicCard }>('PATCH', `/cards/${id}`, patch);
  preview = (id: string) => this.call<Preview>('GET', `/cards/${id}/preview`);
  prompt = (id: string) => this.call<PromptInfo>('GET', `/cards/${id}/prompt`);
  set = (id: string) => this.call<{ card: PublicCard }>('POST', `/cards/${id}/set`);
  roll = (id: string) => this.call<{ card: PublicCard }>('POST', `/cards/${id}/roll`);
  push = (id: string, kind: 'standard' | 'conviction') => this.call<{ card: PublicCard }>('POST', `/cards/${id}/push`, { kind });
  concede = (id: string, kind: ConcessionKind) => this.call<{ card: PublicCard }>('POST', `/cards/${id}/concede`, { kind });
  reveal = (id: string) => this.call<{ card: PublicCard }>('POST', `/cards/${id}/reveal`);
  dice = (id: string) => this.call<{ dice: DiceView }>('GET', `/cards/${id}/dice`);
  written = (id: string, body: { outcomeParagraphId: string; woundName?: string; woundLevel?: string; burdenName?: string }) =>
    this.call<{ card: PublicCard }>('POST', `/cards/${id}/written`, body);
  retcon = (id: string) => this.call<{ card: PublicCard }>('POST', `/cards/${id}/retcon`);
  layDown = (characterId: string, burdenId: string, body: { kind: 'trait' | 'beliefRewrite'; text: string }) =>
    this.call<{ character: Character }>('POST', `/characters/${characterId}/burdens/${burdenId}/lay-down`, body);
}
