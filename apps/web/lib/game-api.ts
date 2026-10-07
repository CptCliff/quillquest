import type { Character, ConcessionKind, Draft, DiceView, OutcomePrompt, PublicCard } from '@quillquest/rules';

export type LedgerCard = PublicCard & { seq: number };

export class ApiFailure extends Error {
  constructor(message: string, public code: string, public status = 0) {
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

export type TokenSource = () => Promise<string>;

/** JSON calls to the sync server through the Next rewrite, with a fresh bearer token each time. */
export class ApiClient {
  constructor(private getToken: TokenSource) {}
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${await this.getToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ApiFailure(json?.error?.message ?? 'Something went wrong', json?.error?.code ?? 'ERROR', res.status);
    return json as T;
  }
}

export interface Profile { userId: string; displayName: string; preferredColor: string | null }
export interface CampaignSummary { id: string; title: string; role: 'gm' | 'player'; color: string; left: boolean }
export interface MemberInfo { userId: string; displayName: string; color: string; role: 'gm' | 'player'; left: boolean }
export interface InviteInfo { id: string; createdAt: string; expiresAt: string; status: 'open' | 'used' | 'revoked' | 'expired'; acceptedBy: string | null }

/** Accounts: profile, campaigns, invites. Everything before (and around) a particular campaign. */
export class AccountApi {
  constructor(private api: ApiClient) {}
  me = () => this.api.request<{ userId: string; email: string | null; profile: Profile; campaigns: CampaignSummary[] }>('GET', '/api/me');
  saveProfile = (displayName: string, preferredColor?: string) => this.api.request<{ profile: Profile }>('PUT', '/api/me/profile', { displayName, preferredColor });
  createCampaign = (title: string) => this.api.request<{ campaign: { id: string; title: string } }>('POST', '/api/campaigns', { title });
  acceptInvite = (token: string) => this.api.request<{ campaignId: string; status: 'joined' | 'already-member' }>('POST', '/api/invites/accept', { token });
  members = (campaign: string) => this.api.request<{ members: MemberInfo[] }>('GET', `/api/campaigns/${campaign}/members`);
  invites = (campaign: string) => this.api.request<{ invites: InviteInfo[] }>('GET', `/api/campaigns/${campaign}/invites`);
  createInvite = (campaign: string) => this.api.request<{ invite: { id: string; token: string; expiresAt: string } }>('POST', `/api/campaigns/${campaign}/invites`);
  revokeInvite = (campaign: string, id: string) => this.api.request<{ revoked: true }>('DELETE', `/api/campaigns/${campaign}/invites/${id}`);
  leave = (campaign: string) => this.api.request<{ left: true }>('POST', `/api/campaigns/${campaign}/leave`);
}

/** The game API for one campaign. */
export class GameApi {
  constructor(private campaign: string, private client: ApiClient) {}

  private call<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.client.request<T>(method, `/api/campaigns/${encodeURIComponent(this.campaign)}${path}`, body);
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
  /** One session-zero step; the server's rules say whether it is allowed. */
  step = (name: string, body: Record<string, unknown> = {}) => this.call<{ done: true }>('POST', `/creation/${name}`, body);
  check = (characterId: string) => this.call<{ passed: boolean; problems: { code: string; message: string }[] }>('GET', `/creation/check/${encodeURIComponent(characterId)}`);
  draft = () => this.call<{ draft: Draft; problems: string[] }>('GET', '/draft');
  saveDraft = (draft: Draft) => this.call<{ draft: Draft; problems: string[] }>('PUT', '/draft', draft);
  importDraft = () => this.call<{ done: true }>('POST', '/draft/import');
  layDown = (characterId: string, burdenId: string, body: { kind: 'trait' | 'beliefRewrite'; text: string }) =>
    this.call<{ character: Character }>('POST', `/characters/${characterId}/burdens/${burdenId}/lay-down`, body);
}
