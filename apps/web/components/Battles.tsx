'use client';
import { useState } from 'react';
import { CONCESSION_KINDS, DANGER_RANKS, DIFFICULTY_RANKS, type BattleDiceView, type Character, type PublicBattle } from '@quillquest/rules';
import type { GameApi } from '../lib/game-api';
import { StepForm, type FieldSpec } from './Forms';
import { useAct } from './Ledger';
import type { Me } from './StoryEditor';

type Run = (fn: () => Promise<unknown>) => Promise<void>;
const rankOptions = (xs: readonly string[]) => xs.map((r) => ({ value: r, label: r }));
const WOUNDS = ['Hurt', 'Wounded', 'Critical', 'Mortal'];

/** The battle cards in the Ledger (design plan 6.3): the GM's frame, the lead's main card, each contributor's card, the push window, beats and the stitched post. */
export function Battles({ battles, characters, me, game, onNotice }: { battles: Record<string, PublicBattle>; characters: Record<string, Character>; me: Me; game: GameApi; onNotice: (m: string) => void }) {
  const { busy, run } = useAct(onNotice);
  const list = Object.values(battles).sort((a, b) => Number(a.status === 'written') - Number(b.status === 'written'));
  if (!list.length) return null;
  return <section aria-label="Battles" data-testid="battles">{list.map((b) => <BattleCard key={b.id} b={b} characters={characters} me={me} game={game} run={run} busy={busy} />)}</section>;
}

const die = (d: { sides: number; value: number }) => `d${d.sides}: ${d.value}`;
/** The reveal view of a battle's dice, in words: the only place the numbers appear. */
function BattleDice({ dice, name, testId }: { dice: BattleDiceView; name: (id: string) => string; testId: string }) {
  const attempt = (a: BattleDiceView['attempt'], label: string) => (
    <div>{label}: Skill {die(a.skill)}{a.backing ? ` · Belief ${die(a.backing)}` : ''} → kept {a.kept}; Difficulty {die(a.difficulty)}</div>
  );
  return (
    <div className="dice" data-testid={testId}>
      {attempt(dice.attempt, 'The attempt')}
      {dice.second && attempt(dice.second, 'The retry')}
      {dice.dangers.map((d) => (
        <div key={d.characterId}>Danger on {name(d.characterId)} ({d.rank}): {die(d)}{d.recheck ? ` · checked again (${d.recheck.rank}): ${die(d.recheck)}` : ''}</div>
      ))}
    </div>
  );
}

function BattleCard({ b, characters, me, game, run, busy }: { b: PublicBattle; characters: Record<string, Character>; me: Me; game: GameApi; run: Run; busy: boolean }) {
  const name = (id: string) => characters[id]?.name ?? id;
  const gm = me.role === 'gm';
  const isLead = b.lead.actorId === me.id;
  const mine = b.contributions.find((c) => c.actorId === me.id);
  const myCharacter = isLead ? b.lead.characterId : mine?.characterId;
  const sheet = characters[b.lead.characterId];
  const landed = (id: string) => b.result?.dangers.find((d) => d.characterId === id && d.hit && !d.withdrawn);
  const rolled = b.status === 'rolled' || b.status === 'conceded';
  const myBeatDone = !!myCharacter && b.beatsWritten.includes(myCharacter);
  const everyone = [{ characterId: b.lead.characterId }, ...b.contributions.filter((c) => c.status !== 'skipped')];
  const [dice, setDice] = useState<BattleDiceView | null>(null);

  return (
    <article className={`card battle${b.status === 'written' ? ' past' : ''}`} data-testid="battle" data-battle={b.id} data-status={b.status} id={`battle-${b.id}`}>
      <header>
        <strong>Battle: {b.goal}</strong> <span className="badge" data-testid="battle-status">{b.status}</span>
      </header>
      <div>Danger: {b.battleDanger}. Lead: {name(b.lead.characterId)}{b.lead.ready ? ` (${b.lead.skillName})` : ' (still filling the main card)'}.</div>
      {b.status === 'declaring' && <div data-testid="battle-waiting">Still declaring: {b.waitingOn.length ? b.waitingOn.map(name).join(', ') : 'no one; the GM can Set'}</div>}
      <ul>
        {b.contributions.map((c) => (
          <li key={c.characterId} data-testid="battle-contribution" data-status={c.status}>
            {name(c.characterId)}: {c.status === 'open' ? 'has not declared' : c.status === 'skipped' ? 'skipped' : `${c.type ?? ''}${c.target ? ` for ${name(c.target)}` : ''} — ${c.line}`}
            {c.status === 'declared' && <> · own Danger {c.dangerRank}: {c.dangerText}</>}{c.status === 'withdrawn' && ' (withdrawn)'}
          </li>
        ))}
      </ul>
      {b.odds && (
        <div data-testid="battle-odds">Odds: the battle is <strong>{b.odds.goal}</strong>; Dangers: {b.odds.dangers.map((d) => `${name(d.characterId)} ${d.word}`).join(', ')}</div>
      )}

      {/* the lead's main card */}
      {isLead && b.status === 'declaring' && (
        <StepForm testId={`battle-${b.id}-lead`} title="Your main card" label="Save" run={run} busy={busy}
          fields={[
            { key: 'want', label: 'Want: what you want, and how you go about it' },
            { key: 'risk', label: 'Risk: what failure feels like' },
            { key: 'skillName', label: 'Skill', kind: 'select', options: (sheet?.skills ?? []).map((s) => ({ value: s.name, label: `${s.name} ${s.rank}` })) },
          ] satisfies FieldSpec[]}
          submit={(v) => game.battleLead(b.id, { want: v.want, risk: v.risk, skillName: v.skillName })} />
      )}

      {/* a contributor's card */}
      {mine && b.status === 'declaring' && mine.status !== 'withdrawn' && mine.status !== 'skipped' && (
        <>
          <StepForm testId={`battle-${b.id}-declare`} title={mine.status === 'declared' ? 'Your contribution (declared; change it if you like)' : 'Declare your contribution'} label="Declare" run={run} busy={busy}
            fields={[
              { key: 'line', label: 'What your character does' },
              { key: 'type', label: 'It shifts', kind: 'select', options: [{ value: 'press', label: 'Press: the lead\'s Skill up' }, { value: 'open', label: 'Open: the Difficulty down' }, { value: 'cover', label: 'Cover: someone\'s Danger down' }] },
              { key: 'target', label: 'Cover whom', kind: 'select', options: [{ value: b.lead.characterId, label: name(b.lead.characterId) }, ...b.contributions.filter((c) => c.characterId !== mine.characterId && (c.status === 'open' || c.status === 'declared')).map((c) => ({ value: c.characterId, label: name(c.characterId) }))] },
              { key: 'dangerRank', label: 'Your own Danger', kind: 'select', options: rankOptions(DANGER_RANKS), initial: 'Real' },
              { key: 'dangerText', label: 'What could happen to you' },
            ] satisfies FieldSpec[]}
            submit={(v) => game.declare(b.id, { line: v.line, type: v.type, target: v.type === 'cover' ? v.target : undefined, dangerRank: v.dangerRank, dangerText: v.dangerText })} />
          <button type="button" className="linklike" data-testid="battle-concede-contribution" disabled={busy} onClick={() => run(() => game.concedeContribution(b.id))}>Concede: leave this battle</button>
        </>
      )}

      {/* the push window */}
      {b.push && (
        <div data-testid="battle-push-window">
          The lead is pushing. Waiting on: {b.push.waiting.map(name).join(', ') || 'no one'}.
          {mine && b.push.waiting.includes(mine.characterId) && (
            <span className="row">
              <button type="button" data-testid="battle-withdraw" disabled={busy} onClick={() => run(() => game.answerPush(b.id, 'withdraw'))}>Withdraw (my shift and Danger leave)</button>
              <button type="button" data-testid="battle-stay" disabled={busy} onClick={() => run(() => game.answerPush(b.id, 'stay'))}>Stay in</button>
            </span>
          )}
          {(gm || isLead) && <button type="button" data-testid="battle-resolve-push" disabled={busy} onClick={() => run(() => game.resolvePush(b.id, gm))}>{gm ? 'Resolve now' : 'Resolve'}</button>}
        </div>
      )}

      {/* the result */}
      {b.result && (
        <div data-testid="battle-result">
          <strong>{b.result.goal ? 'The battle is won.' : 'The battle is lost.'}</strong> {b.result.push !== 'none' && `(pushed: ${b.result.push})`}
          <ul>{b.result.dangers.map((d) => <li key={d.characterId} data-testid="battle-danger" data-character={d.characterId}>{name(d.characterId)}: {d.withdrawn ? 'withdrew' : d.hit ? 'the Danger landed' : 'avoided the Danger'}</li>)}</ul>
        </div>
      )}
      {isLead && b.status === 'rolled' && b.result && !b.result.goal && b.result.push === 'none' && (
        <div className="row" data-testid="battle-push-options">
          <button type="button" data-testid="battle-push-standard" disabled={busy} onClick={() => run(() => game.pushBattle(b.id, 'standard'))}>Try again (standard)</button>
          <button type="button" data-testid="battle-push-conviction" disabled={busy || (characters[b.lead.characterId]?.conviction ?? 0) < 1} onClick={() => run(() => game.pushBattle(b.id, 'conviction'))}>Try again with Conviction</button>
        </div>
      )}
      {isLead && (b.status === 'declaring' || b.status === 'set' || (b.status === 'rolled' && b.result && !b.result.goal && b.result.push === 'none')) && (
        <StepForm testId={`battle-${b.id}-concede`} label="Concede the battle" run={run} busy={busy} fields={[{ key: 'kind', label: 'How', kind: 'select', options: rankOptions(CONCESSION_KINDS) }]} submit={(v) => game.concedeBattle(b.id, String(v.kind))} />
      )}

      {/* beats */}
      {rolled && myCharacter && !gm && b.status !== 'written' && (
        <StepForm testId={`battle-${b.id}-beat`} title={myBeatDone ? 'Your beat (written; rewrite it if you like)' : 'Write your beat: one to three sentences'} label="Save beat" run={run} busy={busy}
          fields={[
            { key: 'text', label: 'Your beat' },
            ...(landed(myCharacter) ? [
              { key: 'costText', label: 'Your Danger landed: write its cost' },
              { key: 'woundName', label: 'Name the wound (or Burden)' },
              { key: 'woundLevel', label: 'How bad', kind: 'select' as const, options: WOUNDS.map((w) => ({ value: w, label: w })), initial: 'Hurt' },
            ] : []),
          ] satisfies FieldSpec[]}
          submit={(v) => game.beat(b.id, { text: String(v.text), ...(v.costText ? { cost: { text: String(v.costText), woundName: String(v.woundName ?? ''), woundLevel: String(v.woundLevel), burdenName: String(v.woundName ?? '') } } : {}) })} />
      )}
      {rolled && <div data-testid="battle-beats">Beats written: {b.beatsWritten.length} of {everyone.length}</div>}

      {/* the GM's controls */}
      {gm && (
        <div className="gm-controls" data-testid="battle-gm">
          {b.status === 'declaring' && b.waitingOn.map((id) => <button key={id} type="button" data-testid="battle-skip" disabled={busy} onClick={() => run(() => game.skipContributor(b.id, id))}>Skip {name(id)}</button>)}
          {b.status === 'declaring' && b.waitingOn.length === 0 && <button type="button" data-testid="battle-set" disabled={busy} onClick={() => run(() => game.setBattle(b.id))}>Set (Difficulty and every Danger)</button>}
          {b.status === 'set' && <button type="button" data-testid="battle-roll" disabled={busy} onClick={() => run(() => game.rollBattle(b.id))}>Roll</button>}
          {rolled && (
            <>
              <button type="button" data-testid="battle-stitch" disabled={busy} onClick={() => run(() => game.stitch(b.id, b.beatsWritten.length < everyone.length))}>{b.beatsWritten.length < everyone.length ? 'Stitch (leave out missing beats)' : 'Stitch the post'}</button>
              <button type="button" disabled={busy} onClick={() => run(async () => { setDice((await game.battleDice(b.id)).dice); })}>See the dice</button>
            </>
          )}
          {dice && <BattleDice dice={dice} name={name} testId="battle-dice" />}
        </div>
      )}
      {b.result && !b.dice && b.status !== 'written' && <button type="button" className="linklike" data-testid="battle-reveal" disabled={busy} onClick={() => run(() => game.revealBattle(b.id))}>Reveal the dice</button>}
      {b.dice && <BattleDice dice={b.dice} name={name} testId="battle-revealed" />}

      {b.post && (
        <div data-testid="battle-post"><strong>The stitched post</strong>
          {b.post.map((p, i) => <p key={i} data-kind={p.kind}>{name(p.characterId)}: {p.text}</p>)}
        </div>
      )}
    </article>
  );
}
