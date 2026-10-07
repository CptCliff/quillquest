'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { majorityOf, type Character, type CreationState, type CrossingProposal, type ChapterState } from '@quillquest/rules';
import { ApiFailure, type GameApi } from '../lib/game-api';
import { Term } from './Term';
import { StepForm, type FieldSpec } from './Forms';
import { myParagraphs, useAct } from './Ledger';
import type { Me } from './StoryEditor';

type Notice = (message: string) => void;
type Run = (fn: () => Promise<unknown>) => Promise<void>;
export interface CreationProps {
  me: Me; characters: Record<string, Character>; creation: Record<string, CreationState>; crossings: CrossingProposal[]; phase: string;
  game: GameApi; editor: Editor | null; onNotice: Notice; campaign: string;
}

const STANDING = ['Distrusted', 'Unknown', 'Known', 'Respected'].map((v) => ({ value: v, label: v }));
const range = (n: number) => Array.from({ length: n }, (_, i) => ({ value: String(i), label: `Chapter ${i + 1}` }));

function paragraphOptions(editor: Editor | null, meId: string, used: Set<string>) {
  // Read on every render: the writer adds paragraphs while this panel is open.
  const paras = editor ? myParagraphs(editor, meId).filter((p) => !used.has(p.id)) : [];
  return [{ value: '', label: paras.length ? 'Choose one of your paragraphs…' : 'Write the paragraph in the Story first' }, ...paras.map((p) => ({ value: p.id, label: p.text }))];
}

function usedParagraphs(creation: Record<string, CreationState>, crossings: CrossingProposal[]): Set<string> {
  const out = new Set<string>();
  for (const s of Object.values(creation)) { if (s.origin.paragraphId) out.add(s.origin.paragraphId); s.chapters.forEach((c) => out.add(c.paragraphId)); }
  crossings.filter((c) => c.status !== 'declined').forEach((c) => out.add(c.paragraphId));
  return out;
}

/** Which kinds of output the chapters have not yet covered, as a sentence for the output form. */
function stillNeeded(st: CreationState): string {
  const have = new Set(st.chapters.flatMap((c) => (c.output ? [c.output.kind] : [])));
  const missing = (['connection', 'resource', 'thread'] as const).filter((k) => !have.has(k));
  return missing.length ? `Still needed: ${missing.join(', ')}.` : 'All three kinds are covered.';
}

/** What the writer sees of a grant slot on their own chapter. */
function slotText(slot: ChapterState['skill'] | ChapterState['trait']): string {
  const a = slot.applied as null | { name?: string; text?: string; by: string; toRank?: string };
  if (a) return `${a.name ?? a.text}${a.toRank ? ` (${a.toRank})` : ''} · ${a.by === 'self' ? 'picked by the writer' : `by ${a.by}`}`;
  return slot.proposals.length ? `${slot.proposals.length} proposed, waiting for agreement` : 'waiting for the other players';
}

/** The player's session-zero panel (design plan 7): a checklist that never lets you forget what is left, and a form for each step. */
export function Creation(p: CreationProps) {
  const { me, characters, creation, crossings, game, editor, onNotice } = p;
  const mine = Object.values(characters).find((c) => c.ownerId === me.id) ?? null;
  const st = mine ? creation[mine.id] : undefined;
  const { busy, run: runAct } = useAct(onNotice);
  const [check, setCheck] = useState<{ passed: boolean; problems: { code: string; message: string }[] } | null>(null);
  const [beliefNotes, setBeliefNotes] = useState<string[]>([]);
  const key = JSON.stringify([st, mine?.beliefs, mine?.threads, mine?.connections, mine?.crossings]);
  useEffect(() => { if (mine && st?.status === 'creating') game.check(mine.id).then(setCheck, () => undefined); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Every action re-reads the checklist when it finishes, so "Still to do" never lags behind a save. */
  const run: Run = async (fn) => { await runAct(fn); if (mine) game.check(mine.id).then(setCheck, () => undefined); };

  if (me.role === 'gm') return <p className="muted">The GM runs session zero from the Director tab. Players write their characters here.</p>;
  if (!mine || !st) return <p className="muted">Your character appears when you open the table.</p>;
  if (me.left) return <p className="muted">You left this campaign.</p>;

  const used = usedParagraphs(creation, crossings);
  const paraOptions = paragraphOptions(editor, me.id, used);
  const others = Object.values(characters).filter((c) => c.ownerId && !c.left && c.id !== mine.id);
  const maxChapters = st.veteran ? 4 : 3;
  const act = (name: string, body: Record<string, unknown> = {}) => game.step(name, body);

  return (
    <section aria-label="Creation" data-testid="creation">
      <h3>Your character <span className="badge" data-testid="creation-status">{st.status === 'ready' ? 'ready' : 'creating'}</span></h3>
      {p.phase === 'playing' && st.status === 'creating' && <p className="muted">Play has begun. Keep creating while the others play; you cannot roll until you finish (or the GM overrides the check).</p>}

      {st.status === 'creating' ? (
        <div data-testid="checklist">
          <strong>Still to do</strong>
          {check?.passed ? <p data-testid="check-passed">Everything is in place.</p> : (
            <ul>{(check?.problems ?? []).map((x) => <li key={x.code + x.message} data-testid="check-problem" data-code={x.code}>{x.message}</li>)}</ul>
          )}
          <button type="button" data-testid="finish" disabled={!check?.passed || busy} onClick={() => run(() => act('finish'))}>Finish creation</button>
        </div>
      ) : <p>{mine.name} is ready to play.</p>}

      <p className="muted">Unsure of a word? Tap any underlined word, or open <strong>Words</strong> at the top.</p>
      <p className="muted">Solo draft: <Link href={`/draft/${p.campaign}`} data-testid="draft-link">write your Origin and chapters in private</Link>, then bring them here.</p>

      {st.status === 'creating' && (<>
        <h3>1 · <Term k="origin">Origin</Term></h3>
        {st.origin.paragraphId ? <p>Origin posted.</p> : (
          <StepForm testId="origin-post" fields={[{ key: 'paragraphId', label: 'Your Origin paragraph', kind: 'select', options: paraOptions }]} label="Post Origin" run={run} busy={busy}
            submit={(v) => act('origin-post', { paragraphId: v.paragraphId })} />
        )}
        {st.origin.skill ? <p>Origin Skill: {st.origin.skill}. First Connection: {st.origin.connection}.</p> : (
          <StepForm testId="origin-picks" keep fields={[{ key: 'skill', label: 'A Skill from your Origin (starts Trained)' }, { key: 'connection', label: 'A Connection from your Origin' }]} label="Save picks" run={run} busy={busy}
            submit={(v) => act('origin-picks', { skill: v.skill, connection: v.connection })} />
        )}

        <h3>2 · <Term k="chapter">Life chapters</Term> ({st.chapters.length} of {maxChapters})</h3>
        {st.chapters.length === 0 && (
          <label className="check"><input type="checkbox" data-testid="veteran" checked={st.veteran} onChange={(e) => run(() => act('veteran', { veteran: e.target.checked }))} /> A veteran: four chapters instead of three</label>
        )}
        {st.chapters.map((ch) => <ChapterBlock key={ch.index} ch={ch} st={st} others={others} run={run} busy={busy} act={act} game={game} characterId={mine.id} stillNeeded={stillNeeded(st)} />)}
        {st.origin.paragraphId && st.chapters.length < maxChapters && (
          <StepForm testId="chapter" title="Post the next chapter" label="Post chapter" run={run} busy={busy}
            fields={[
              { key: 'paragraphId', label: 'The chapter paragraph', kind: 'select', options: paraOptions },
              { key: 'summary', label: 'One line: what happened' },
              { key: 'endsBadly', label: 'This is the chapter that ended badly (exactly one; not the first or the most recent)', kind: 'check' },
              { key: 'testedBelief', label: 'It tested what I believe', kind: 'check' },
            ]}
            submit={(v) => act('chapter', { paragraphId: v.paragraphId, summary: v.summary, endsBadly: v.endsBadly, testedBelief: v.testedBelief })} />
        )}

        <h3>3 · <Term k="crossing">Crossing paths</Term></h3>
        <Crossings st={st} mine={mine} others={others} creation={creation} crossings={crossings} characters={characters} paraOptions={paraOptions} run={run} busy={busy} act={act} />

        <h3>4 · <Term k="capital">Capital</Term></h3>
        <StepForm testId="capital" keep label="Save Capital" run={run} busy={busy}
          fields={[
            ...st.standingPrompts.map((c): FieldSpec => ({ key: `standing:${c}`, label: `How is ${c} seen? (you named it)`, kind: 'select', options: STANDING, initial: mine.standing[c] ?? 'Unknown' })),
            ...[1, 2, 3].flatMap((i): FieldSpec[] => [{ key: `pn${i}`, label: `Possession ${i} (optional)` }, { key: `ps${i}`, label: `Possession ${i}: its story, in a line` }]),
          ]}
          submit={(v) => act('capital', {
            standing: Object.fromEntries(st.standingPrompts.map((c) => [c, v[`standing:${c}`] || 'Unknown'])),
            possessions: [1, 2, 3].filter((i) => String(v[`pn${i}`]).trim()).map((i) => ({ name: v[`pn${i}`], story: v[`ps${i}`] })),
          })} />
        {mine.possessions.length > 0 && <p>Possessions: {mine.possessions.map((x) => x.name).join(' · ')}</p>}

        <h3>5 · <Term k="belief">Beliefs</Term> and <Term k="instinct">Instincts</Term></h3>
        <StepForm testId="beliefs" keep label="Save Beliefs" run={run} busy={busy}
          secondary={{ label: 'Check my Beliefs with Claude', testId: 'check', onClick: async (v) => {
            const out: string[] = [];
            for (const kind of ['objective', 'relationship', 'worldview']) {
              if (!String(v[kind]).trim()) continue;
              const r = (await game.ask('beliefCheck', { kind, text: v[kind] })).suggestion.draft as { conviction: boolean; action: boolean; fix: string | null };
              out.push(r.conviction && r.action ? `${kind}: holds a conviction and an action.` : `${kind}: ${r.fix}`);
            }
            setBeliefNotes(out);
          } }}
          fields={[
            { key: 'objective', label: 'An objective: what you are trying to do', initial: mine.beliefs.find((b) => b.kind === 'objective')?.text },
            { key: 'relationship', label: 'A relationship: who you stand by', initial: mine.beliefs.find((b) => b.kind === 'relationship')?.text },
            { key: 'worldview', label: 'A worldview (your Core Belief)', initial: mine.beliefs.find((b) => b.kind === 'worldview')?.text },
          ]}
          submit={(v) => act('beliefs', { beliefs: ['objective', 'relationship', 'worldview'].map((kind) => ({ kind, text: v[kind] })) })} />
        {beliefNotes.length > 0 && <ul data-testid="belief-check-result">{beliefNotes.map((n) => <li key={n}>{n}</li>)}</ul>}
        <StepForm testId="instincts" keep label="Save Instincts" run={run} busy={busy}
          fields={[0, 1, 2].map((i): FieldSpec => ({ key: `i${i}`, label: `Instinct ${i + 1}`, initial: mine.instincts[i]?.text }))}
          submit={(v) => act('instincts', { instincts: [v.i0, v.i1, v.i2] })} />
        {st.chapters.some((c) => c.endsBadly && c.testedBelief) && !st.burdenChosen && mine.beliefs.length === 3 && (
          <StepForm testId="burden" title="Your bad chapter tested a Belief: start with a Burden on it?" label="Take the Burden" run={run} busy={busy}
            fields={[{ key: 'beliefId', label: 'Which Belief', kind: 'select', options: mine.beliefs.map((b) => ({ value: b.id, label: b.text })) }, { key: 'name', label: 'Name the Burden' }]}
            submit={(v) => act('burden', { beliefId: v.beliefId, name: v.name })} />
        )}

        <h3>6 · The hook</h3>
        <p className="muted">Start play with a <Term k="thread">Thread</Term> from your past.</p>
        {mine.threads.length === 0 ? <p className="muted">You have no Threads yet; a chapter or a crossing gives you one.</p> : (
          <StepForm testId="hook" keep label="Start play with this Thread" run={run} busy={busy}
            fields={[{ key: 'threadId', label: 'The unfinished business your first scene follows', kind: 'select', options: mine.threads.map((t) => ({ value: t.id, label: t.text })), initial: st.hookThreadId ?? undefined }]}
            submit={(v) => act('hook', { threadId: v.threadId })} />
        )}
      </>)}

      <GrantCards me={me} others={others} characters={characters} creation={creation} run={run} busy={busy} act={act} game={game} />
    </section>
  );
}

function ChapterBlock({ ch, st, others, run, busy, act, game, characterId, stillNeeded: needed }: {
  characterId: string; stillNeeded: string; ch: ChapterState; st: CreationState; others: Character[]; run: Run; busy: boolean; game: GameApi;
  act: (n: string, b?: Record<string, unknown>) => Promise<unknown>;
}) {
  return (
    <div className="chapter" data-testid="chapter-block" data-index={ch.index}>
      <strong>Chapter {ch.index + 1}{ch.endsBadly ? ' · ended badly' : ''}</strong>: {ch.summary}
      <div><Term k="skill">Skill</Term>: <span data-testid="chapter-skill">{slotText(ch.skill)}</span>{ch.skill.applied && !st.swapUsed && <button type="button" className="linklike" data-testid="swap-skill" onClick={() => run(() => act('swap', { chapter: ch.index, part: 'skill' }))}> swap</button>}</div>
      <div><Term k="trait">Trait</Term>: <span data-testid="chapter-trait">{slotText(ch.trait)}</span>{ch.trait.applied && !st.swapUsed && <button type="button" className="linklike" data-testid="swap-trait" onClick={() => run(() => act('swap', { chapter: ch.index, part: 'trait' }))}> swap</button>}</div>
      {(!ch.skill.applied || !ch.trait.applied) && <ChapterOffer ch={ch} st={st} run={run} busy={busy} act={act} game={game} characterId={characterId} />}
      {ch.output ? <div>Output: {ch.output.kind} — {ch.output.text}</div> : (
        <StepForm testId={`output-${ch.index}`} title="What does this chapter leave you?" hint={`Across your chapters you need one Connection, one Resource and one Thread, and the chapter that ended badly must leave a Thread. ${needed} A chosen output cannot be changed.`} label="Save output" run={run} busy={busy}
          fields={[
            { key: 'kind', label: `Chapter ${ch.index + 1} leaves you`, kind: 'select', options: ch.endsBadly ? [{ value: 'thread', label: 'A Thread (the bad chapter must)' }] : [{ value: 'connection', label: 'A Connection' }, { value: 'resource', label: 'A Resource' }, { value: 'thread', label: 'A Thread' }] },
            { key: 'text', label: 'What this chapter leaves you, in a line' },
            { key: 'withCharacterId', label: 'A Connection with (optional)', kind: 'select', options: [{ value: '', label: 'no one in particular' }, ...others.map((c) => ({ value: c.id, label: c.name }))] },
            { key: 'raise', label: 'A Resource raises', kind: 'select', options: [{ value: 'wealth', label: 'Wealth' }, { value: 'network', label: 'Network' }] },
          ]}
          submit={(v) => act('output', { chapter: ch.index, output: { kind: v.kind, text: v.text, ...(v.kind === 'connection' && v.withCharacterId ? { withCharacterId: v.withCharacterId } : {}), ...(v.kind === 'resource' ? { raise: v.raise } : {}) } })} />
      )}
      {ch.factId ? <div>World fact written.</div> : (
        <StepForm testId={`fact-${ch.index}`} title="A fact about the world this chapter shows" label="Add to the Canon" run={run} busy={busy}
          fields={[{ key: 'text', label: 'The fact' }, { key: 'community', label: 'A community it names (optional)' }]}
          submit={(v) => act('fact', { chapter: ch.index, text: v.text, community: v.community || undefined })} />
      )}
    </div>
  );
}

const OWN = '__own';

/** The chapter library's offer for one of your chapters: pick a Skill and a Trait from a list instead of waiting for the others to propose. */
function ChapterOffer({ ch, st, run, busy, act, game, characterId }: { characterId: string; ch: ChapterState; st: CreationState; run: Run; busy: boolean; game: GameApi; act: (n: string, b?: Record<string, unknown>) => Promise<unknown> }) {
  const offer = ch.offer ?? null;
  const n = ch.index;
  if (!offer) {
    return (
      <div data-testid={`offer-${n}`} className="offer">
        <button type="button" data-testid={`offer-get-${n}`} disabled={busy} onClick={() => run(() => act('chapter-offer', { chapter: n }))}>Suggest a Skill and Trait from the chapter library</button>
        <p className="muted">Or wait: the other players can propose a Skill and a Trait for you below.</p>
      </div>
    );
  }
  const raiseOption = offer.raise && !ch.skill.applied ? [{ value: `__raise:${offer.raise}`, label: `Raise ${offer.raise} to Capable (once, for the whole of creation)` }] : [];
  const skillOptions = [{ value: '', label: ch.skill.applied ? 'Already settled' : 'Choose a Skill…' }, ...offer.skills.map((x) => ({ value: x, label: `${x} (new, Trained)` })), ...raiseOption];
  const traitOptions = [{ value: '', label: ch.trait.applied ? 'Already settled' : 'Choose a Trait…' }, ...offer.traits.map((x) => ({ value: x, label: x }))];
  const title = offer.tier === 'none' ? 'No close match in the chapter library' : `${offer.source === 'ai' ? 'Adapted from' : 'Close to'} “${offer.name}”`;
  return (
    <div data-testid={`offer-${n}`} className="offer" data-source={offer.source} data-tier={offer.tier}>
      <strong>{title}</strong>
      {offer.tier === 'partial' && offer.source === 'library' && (
        <button type="button" className="linklike" data-testid={`offer-adapt-${n}`} disabled={busy}
          onClick={() => run(async () => { const draft = (await game.ask('grant', { characterId, chapter: n, adapt: true })).suggestion.draft as { skills: string[]; traits: string[] }; await act('chapter-offer', { chapter: n, adapted: draft }); })}>Adapt it to my chapter with Claude</button>
      )}
      {offer.tier !== 'none' && <p className="muted">Ideas for what the chapter leaves you: Connection, {offer.outputs.connection[0] ?? '—'}; Resource, {offer.outputs.resource[0] ?? '—'}; Thread, {offer.outputs.thread[0] ?? '—'}.</p>}
      {ch.skill.reopened && !ch.skill.applied && <p className="muted" data-testid={`offer-objected-${n}`}>The others objected to your Skill pick, so they are proposing one for chapter {n + 1} now.</p>}
      <StepForm testId={`pick-${n}`} label="Take my picks" run={run} busy={busy}
        fields={[
          ...(ch.skill.applied || ch.skill.reopened ? [] : [{ key: 'skill', label: `Skill for chapter ${n + 1}`, kind: 'select' as const, options: skillOptions }, { key: 'skillOwn', label: `Or a Skill in your own words (chapter ${n + 1})` }]),
          ...(ch.trait.applied ? [] : [{ key: 'trait', label: `${ch.endsBadly ? 'Harmful Trait' : 'Trait'} for chapter ${n + 1}`, kind: 'select' as const, options: traitOptions }, { key: 'traitOwn', label: `Or a ${ch.endsBadly ? 'harmful ' : ''}Trait in your own words (chapter ${n + 1})` }]),
        ]}
        submit={(v) => {
          const body: Record<string, unknown> = { chapter: n };
          const skill = String(v.skillOwn ?? '').trim() || String(v.skill ?? '');
          if (skill) {
            if (String(v.skillOwn ?? '').trim()) { body.skill = skill; body.skillOwn = true; }
            else if (skill.startsWith('__raise:')) { body.skill = skill.slice(8); body.raise = true; }
            else body.skill = skill;
          }
          const trait = String(v.traitOwn ?? '').trim() || String(v.trait ?? '');
          if (trait) { body.trait = trait; if (String(v.traitOwn ?? '').trim()) body.traitOwn = true; }
          if (!body.skill && !body.trait) return Promise.reject(new ApiFailure('Choose a Skill or a Trait first', 'BAD_INPUT', 400));
          return act('chapter-pick', body);
        }} />
      <p className="muted">The others can <Term k="object">object</Term> to a pick; then they propose instead. {st.selfRaiseUsed ? 'Your one raise to Capable is spent.' : ''}</p>
    </div>
  );
}

function Crossings({ st, mine, others, creation, crossings, characters, paraOptions, run, busy, act }: {
  st: CreationState; mine: Character; others: Character[]; creation: Record<string, CreationState>; crossings: CrossingProposal[]; characters: Record<string, Character>;
  paraOptions: { value: string; label: string }[]; run: Run; busy: boolean; act: (n: string, b?: Record<string, unknown>) => Promise<unknown>;
}) {
  const [to, setTo] = useState(others[0]?.id ?? '');
  const target = others.find((c) => c.id === (to || others[0]?.id));
  const theirs = creation[target?.id ?? '']?.chapters.length ?? 0;
  const mineAll = crossings.filter((c) => c.from === mine.id || c.to === mine.id);
  const name = (id: string) => characters[id]?.name ?? id;
  return (
    <div data-testid="crossings">
      <p>{mine.crossings.length} of 2 crossings made. {mine.crossings.some((c) => c.touchesBelief) ? '' : 'One should touch a Belief.'}</p>
      {mineAll.map((c) => (
        <div key={c.id} data-testid="crossing" data-status={c.status}>
          {name(c.from)} and {name(c.to)}: chapter {c.fromChapter + 1} meets chapter {c.toChapter + 1} <span className="badge">{c.status}</span>
          {c.status === 'pending' && c.to === mine.id && (
            <span className="row">
              <button type="button" data-testid="crossing-confirm" disabled={busy} onClick={() => run(() => act('crossing-confirm', { proposalId: c.id }))}>Confirm</button>
              <button type="button" data-testid="crossing-decline" disabled={busy} onClick={() => run(() => act('crossing-decline', { proposalId: c.id }))}>Decline</button>
            </span>
          )}
        </div>
      ))}
      {others.length > 0 && mine.crossings.length < 2 && st.chapters.length > 0 && (
        <>
          <label className="field"><span>Cross paths with</span>
            <select data-testid="crossing-with" value={to || others[0]!.id} onChange={(e) => setTo(e.target.value)}>{others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <StepForm testId="crossing-form" done={`Proposed. Waiting for ${target?.name ?? 'them'} to confirm.`} label="Propose the crossing" run={run} busy={busy} disabled={!theirs}
            fields={[
              { key: 'fromChapter', label: 'In your chapter', kind: 'select', options: range(st.chapters.length) },
              { key: 'toChapter', label: 'In theirs', kind: 'select', options: range(theirs) },
              { key: 'paragraphId', label: 'The scene you wrote', kind: 'select', options: paraOptions },
              { key: 'touchesBelief', label: 'It touches one of my Beliefs', kind: 'check' },
              { key: 'fromConnection', label: 'Your Connection to them' },
              { key: 'toConnection', label: 'Their Connection to you' },
              { key: 'thread', label: 'A Thread you now share (optional)' },
            ]}
            submit={(v) => act('crossing', { toCharacterId: to || others[0]!.id, fromChapter: Number(v.fromChapter), toChapter: Number(v.toChapter), paragraphId: v.paragraphId, touchesBelief: v.touchesBelief, fromConnection: v.fromConnection, toConnection: v.toConnection, thread: v.thread || undefined })} />
        </>
      )}
    </div>
  );
}

/** Grant cards waiting on you: the other players' chapters, where you propose a Skill and a Trait or agree with a proposal. */
function GrantCards({ me, others, characters, creation, run, busy, act, game }: {
  game: GameApi; me: Me; others: Character[]; characters: Record<string, Character>; creation: Record<string, CreationState>; run: Run; busy: boolean; act: (n: string, b?: Record<string, unknown>) => Promise<unknown>;
}) {
  const open = others.flatMap((c) => (creation[c.id]?.chapters ?? []).map((ch) => ({ c, ch }))).filter(({ ch }) => !ch.skill.applied || !ch.trait.applied || (ch.skill.applied as { by?: string }).by === 'self' || (ch.trait.applied as { by?: string }).by === 'self');
  if (!others.length) return null;
  const needed = majorityOf(others.length);
  const who = (id: string) => Object.values(characters).find((c) => c.ownerId === id)?.name ?? id;
  return (
    <>
      <h3>Grant cards for the others</h3>
      {open.length === 0 && <p className="muted" data-testid="no-grants">Nothing is waiting on you.</p>}
      {open.map(({ c, ch }) => (
        <div key={`${c.id}-${ch.index}`} className="card" data-testid="grant-card" data-character={c.id} data-chapter={ch.index}>
          <strong>{c.name}, chapter {ch.index + 1}{ch.endsBadly ? ' (ended badly: the Trait is harmful)' : ''}</strong>: {ch.summary}
          <GrantIdeas game={game} characterId={c.id} chapter={ch.index} run={run} busy={busy} act={act} />
          {(['skill', 'trait'] as const).map((part) => {
            const slot = ch[part] as ChapterState['skill'] & ChapterState['trait'];
            if (slot.applied) return (
              <div key={part} data-testid={`grant-${part}-done`}>{part === 'skill' ? 'Skill' : 'Trait'}: {slotText(slot)}
                {(slot.applied as { by?: string }).by === 'self' && <button type="button" className="linklike" data-testid="object" disabled={busy} onClick={() => run(() => act('chapter-object', { characterId: c.id, chapter: ch.index, part }))}> Object</button>}
              </div>
            );
            return (
              <div key={part} data-testid={`grant-${part}`}>
                <em>{part === 'skill' ? 'Skill' : 'Trait'}</em> (needs {needed} of {others.length} to agree)
                {slot.proposals.map((p) => {
                  const q = p as unknown as { id: string; by: string; accepts: string[]; skill?: string; mode?: string; trait?: string };
                  return (
                    <div key={q.id} className="row" data-testid="proposal">
                      <span>{q.skill ? `${q.skill} (${q.mode === 'raise' ? 'raise a rank' : 'new, Trained'})` : q.trait} — {who(q.by)}, {q.accepts.length} agree</span>
                      {q.accepts.includes(me.id) && <button type="button" className="linklike" data-testid="withdraw" disabled={busy} onClick={() => run(() => act('withdraw', { characterId: c.id, chapter: ch.index, part }))}>Withdraw my vote</button>}
                      {!q.accepts.includes(me.id) && <button type="button" data-testid="accept" disabled={busy} onClick={() => run(() => act('accept', { characterId: c.id, chapter: ch.index, part, proposalId: q.id }))}>Agree</button>}
                    </div>
                  );
                })}
                <StepForm testId={`propose-${part}-${c.id}-${ch.index}`} label="Propose" run={run} busy={busy}
                  fields={part === 'skill'
                    ? [{ key: 'skill', label: `A Skill for ${c.name}, chapter ${ch.index + 1}` }, { key: 'mode', label: `Skill type for ${c.name}, chapter ${ch.index + 1}`, kind: 'select', options: [{ value: 'new', label: 'New, at Trained' }, { value: 'raise', label: 'One they have, raised a rank' }] }]
                    : [{ key: 'trait', label: `${ch.endsBadly ? 'A harmful Trait' : 'A Trait'} for ${c.name}, chapter ${ch.index + 1}` }]}
                  submit={(v) => act(part === 'skill' ? 'propose-skill' : 'propose-trait', { characterId: c.id, chapter: ch.index, ...(part === 'skill' ? { skill: v.skill, mode: v.mode } : { trait: v.trait }) })} />
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** Ideas from Claude for one chapter: chips you can send straight to the grant card as your proposal. Drafts only. */
function GrantIdeas({ game, characterId, chapter, run, busy, act }: { game: GameApi; characterId: string; chapter: number; run: Run; busy: boolean; act: (n: string, b?: Record<string, unknown>) => Promise<unknown> }) {
  const [ideas, setIdeas] = useState<{ skills: string[]; traits: string[] } | null>(null);
  return (
    <div data-testid="grant-ideas">
      <button type="button" className="linklike" data-testid="grant-suggest" disabled={busy} onClick={() => run(async () => { setIdeas((await game.ask('grant', { characterId, chapter })).suggestion.draft as { skills: string[]; traits: string[] }); })}>Ideas from Claude</button>
      {ideas && (
        <div className="row">
          {ideas.skills.map((s) => <button key={`s-${s}`} type="button" data-testid="idea-skill" disabled={busy} title="Propose this Skill (new, at Trained)" onClick={() => run(() => act('propose-skill', { characterId, chapter, skill: s, mode: 'new' }))}>Skill: {s}</button>)}
          {ideas.traits.map((s) => <button key={`t-${s}`} type="button" data-testid="idea-trait" disabled={busy} title="Propose this Trait" onClick={() => run(() => act('propose-trait', { characterId, chapter, trait: s }))}>Trait: {s}</button>)}
        </div>
      )}
    </div>
  );
}
