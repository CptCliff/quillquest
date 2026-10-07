import type { Layout } from '@quillquest/layout';
import type { BattleDiceView, Character, ConcessionKind, Draft, DiceView, Nomination, Npc, NpcField, OutcomePrompt, PublicBattle, PublicCard } from '@quillquest/rules';
import type { Draft as AiDraft, SuggestionKind } from '@quillquest/prompts';

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

export interface Settings { themes: string; faces: string[]; cap: number; stallHours: number; pushWindowMinutes: number; sessionNo: number; used: number; configured: boolean }
export interface SuggestionRow { id: string; userId: string; kind: SuggestionKind; input: unknown; output: unknown; status: 'shown' | 'used' | 'edited' | 'dismissed' | 'failed'; sessionNo: number; provider: string; createdAt: string }
export interface AskResult { suggestion: { id: string; kind: SuggestionKind; draft: AiDraft; cached?: boolean }; remaining: number }

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
  discard = (id: string) => this.call<{ discarded: true }>('DELETE', `/cards/${id}`);
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
  // ---- the Director and Claude -----------------------------------------------------------------------------------------
  director = () => this.call<{ nominations: Nomination[]; npcs: Npc[]; settings: Settings }>('GET', '/director');
  saveSettings = (s: { themes?: string; faces?: string[]; cap?: number; stallHours?: number; pushWindowMinutes?: number }) => this.call<{ themes: string; faces: string[]; cap: number }>('PUT', '/settings', s);
  startSession = () => this.call<{ sessionNo: number }>('POST', '/session/start');
  nominate = (b: { characterId: string; kind: string; beliefId?: string; note: string }) => this.call<unknown>('POST', '/conviction/nominate', b);
  awardNomination = (nominationId: string) => this.call<unknown>('POST', '/conviction/award', { nominationId });
  awardDirect = (b: { characterId: string; kind: string; beliefId?: string; note: string }) => this.call<unknown>('POST', '/conviction/award', b);
  declineNomination = (nominationId: string) => this.call<unknown>('POST', '/conviction/decline', { nominationId });
  createNpc = (name: string) => this.call<Npc>('POST', '/npcs', { name });
  editNpc = (id: string, patch: Partial<Pick<Npc, 'name' | 'skills' | 'beliefs' | 'notes'>>) => this.call<Npc>('PATCH', `/npcs/${id}`, patch);
  revealNpc = (id: string, field: NpcField) => this.call<Npc>('POST', `/npcs/${id}/reveal`, { field });
  ask = (kind: SuggestionKind, params: Record<string, unknown>) => this.call<AskResult>('POST', `/llm/${kind}`, params);
  suggestions = () => this.call<{ suggestions: SuggestionRow[] }>('GET', '/suggestions');
  suggestionStatus = (id: string, status: 'used' | 'edited' | 'dismissed') => this.call<{ updated: true }>('POST', `/suggestions/${id}/status`, { status });
  // ---- battles, the spotlight, notifications ---------------------------------------------------------------------------------
  private battle = (id: string, action: string, body?: unknown) => this.call<{ battle: PublicBattle }>('POST', `/battles/${id}/${action}`, body ?? {});
  openBattle = (b: { goal: string; battleDanger: string; difficulty: string; dangerRank: string; leadCharacterId: string; framingParagraphId?: string }) => this.call<{ battle: PublicBattle }>('POST', '/battles', b);
  battleLead = (id: string, patch: Record<string, unknown>) => this.call<{ battle: PublicBattle }>('PATCH', `/battles/${id}/lead`, patch);
  declare = (id: string, b: Record<string, unknown>) => this.battle(id, 'declare', b);
  concedeContribution = (id: string) => this.battle(id, 'concede');
  skipContributor = (id: string, characterId: string) => this.battle(id, 'skip', { characterId });
  setBattle = (id: string, adjust: { difficulty?: string; dangers?: Record<string, string> } = {}) => this.battle(id, 'set', adjust);
  rollBattle = (id: string) => this.battle(id, 'roll');
  pushBattle = (id: string, kind: 'standard' | 'conviction') => this.battle(id, 'push', { kind });
  answerPush = (id: string, answer: 'withdraw' | 'stay') => this.battle(id, 'answer', { answer });
  resolvePush = (id: string, force = false) => this.battle(id, 'resolve-push', { force });
  concedeBattle = (id: string, kind: string) => this.battle(id, 'concede-battle', { kind });
  beat = (id: string, b: { text: string; cost?: { text: string; woundName?: string; woundLevel?: string; burdenName?: string } }) => this.battle(id, 'beat', b);
  orderBeats = (id: string, ids: string[]) => this.battle(id, 'order', { ids });
  stitch = (id: string, skipMissing = false) => this.battle(id, 'stitch', { skipMissing });
  revealBattle = (id: string) => this.battle(id, 'reveal');
  battleDice = (id: string) => this.call<{ dice: BattleDiceView }>('GET', `/battles/${id}/dice`);
  passSpotlight = (to: string) => this.call<{ holder: string | null }>('POST', '/spotlight/pass', { to });
  takeSpotlight = () => this.call<{ holder: string | null }>('POST', '/spotlight/take');
  prefs = () => this.call<{ mode: 'immediate' | 'digest' | 'off'; hasEmail: boolean }>('GET', '/prefs');
  savePrefs = (mode: 'immediate' | 'digest' | 'off') => this.call<{ mode: string }>('PUT', '/prefs', { mode });
  layout = (device: 'wide' | 'phone') => this.call<{ layout: Layout; saved: boolean }>('GET', `/layout?device=${device}`);
  saveLayout = (device: 'wide' | 'phone', layout: Layout) => this.call<{ layout: Layout }>('PUT', `/layout?device=${device}`, { layout });
  resetLayout = (device: 'wide' | 'phone') => this.call<{ layout: Layout; saved: boolean }>('DELETE', `/layout?device=${device}`);
  layDown = (characterId: string, burdenId: string, body: { kind: 'trait' | 'beliefRewrite'; text: string }) =>
    this.call<{ character: Character }>('POST', `/characters/${characterId}/burdens/${burdenId}/lay-down`, body);
}
