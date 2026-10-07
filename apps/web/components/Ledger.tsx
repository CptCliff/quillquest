'use client';
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { CONCESSION_KINDS, DANGER_RANKS, DIFFICULTY_RANKS, type Character, type ConcessionKind, type DiceView, type WoundLevel } from '@quillquest/rules';
import { ApiFailure, type GameApi, type LedgerCard, type PromptInfo, type Preview } from '../lib/game-api';
import { DANGER_LABELS, OUTCOME_LABELS, STATUS_LABELS, THREATS } from '../lib/words';
import type { Me } from './StoryEditor';

type Notice = (message: string) => void;
interface Env { api: GameApi; me: Me; characters: Record<string, Character>; editor: Editor | null; onNotice: Notice; openCharacter: (characterId: string) => void }

const nameOf = (characters: Record<string, Character>, id: string | null) => (id ? characters[id]?.name ?? id : '');

// ---- helpers over the editor ------------------------------------------------------------------------------------------

interface MyParagraph { id: string; text: string; locked: boolean }
export function myParagraphs(editor: Editor | null, meId: string): MyParagraph[] {
  const out: MyParagraph[] = [];
  editor?.state.doc.forEach((n) => {
    const text = n.textContent.trim();
    // An empty paragraph is not something to post, and the pickers only fill up with "(empty)" if they list it.
    if (n.attrs.paragraphId && n.attrs.authorId === meId && text) out.push({ id: n.attrs.paragraphId, text: text.length > 60 ? `${text.slice(0, 59)}…` : text, locked: !!n.attrs.locked });
  });
  return out;
}
/** The paragraph the writer is in, if it is theirs; otherwise their latest one. */
function currentParagraph(editor: Editor | null, meId: string): string | null {
  if (!editor) return null;
  const $from = editor.state.selection.$from;
  const here = $from.depth >= 1 ? $from.node(1).attrs : null;
  if (here?.paragraphId && here.authorId === meId) return here.paragraphId;
  return myParagraphs(editor, meId).at(-1)?.id ?? null;
}

export function useAct(onNotice: Notice) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { onNotice(e instanceof ApiFailure ? e.message : 'Something went wrong'); } finally { setBusy(false); }
  };
  return { busy, run };
}

// ---- small fields that save on commit ---------------------------------------------------------------------------------

function TextField({ label, value, onCommit, multiline, disabled, testId }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; disabled?: boolean; testId: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const props = { value: v, disabled, 'data-testid': testId, 'aria-label': label, onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setV(e.target.value), onBlur: () => v !== value && onCommit(v) };
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? <textarea rows={2} {...props} /> : <input {...props} />}
    </label>
  );
}
function SelectField({ label, value, options, onCommit, disabled, testId }: { label: string; value: string; options: { value: string; label: string }[]; onCommit: (v: string) => void; disabled?: boolean; testId: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} data-testid={testId} aria-label={label} onChange={(e) => onCommit(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

// ---- dice (the reveal view: the only place numbers appear) -------------------------------------------------------------

const die = (d: { sides: number; value: number }) => `d${d.sides}: ${d.value}`;
export function DiceBox({ dice }: { dice: DiceView }) {
  return (
    <div className="dice" data-testid="dice">
      <div>Skill {die(dice.skill)}{dice.backing ? ` · Belief ${die(dice.backing)}` : ''} → kept {dice.kept}</div>
      <div>Difficulty {die(dice.difficulty)}</div>
      <div>Danger ({dice.danger.rank}) {die(dice.danger)}</div>
      {dice.second && <div>Retry: Skill {die(dice.second.skill)}{dice.second.backing ? ` · Belief ${die(dice.second.backing)}` : ''} → kept {dice.second.kept}; Difficulty {die(dice.second.difficulty)}</div>}
      {dice.recheck && <div>Danger checked again ({dice.recheck.rank}) {die(dice.recheck)}</div>}
    </div>
  );
}

function DiceReveal({ card, env }: { card: LedgerCard; env: Env }) {
  const { run, busy } = useAct(env.onNotice);
  const [gmDice, setGmDice] = useState<DiceView | null>(null);
  if (card.dice) return <DiceBox dice={card.dice} />;
  if (!card.outcome) return null;
  return (
    <div className="actions">
      <button disabled={busy} data-testid="reveal" onClick={() => run(() => env.api.reveal(card.id))}>Reveal dice</button>
      {env.me.role === 'gm' && <button disabled={busy} data-testid="gm-dice" onClick={() => run(async () => setGmDice((await env.api.dice(card.id)).dice))}>Dice (GM)</button>}
      {gmDice && <DiceBox dice={gmDice} />}
    </div>
  );
}

// ---- the card ---------------------------------------------------------------------------------------------------------

function Summary({ card }: { card: LedgerCard }) {
  return (
    <div className="summary">
      <div>{card.skillRank} {card.skillName} against {card.difficulty ?? '?'}, Danger {card.danger ?? '?'}{card.severity && card.worstWound ? ` (worst: ${card.worstWound})` : ''}</div>
      {card.backing && card.backing !== 'none' && <div>Backed by a {card.backing === 'core' ? 'Core Belief' : 'Belief'}</div>}
      {card.shifts.length > 0 && <ul className="shifts">{card.shifts.map((s, i) => <li key={i}>{s.ladder} {s.delta > 0 ? 'up' : 'down'}: {s.reason}</li>)}</ul>}
      {card.odds && <div data-testid="odds">Goal: <strong>{card.odds.goal}</strong> · Danger: <strong>{card.odds.danger}</strong></div>}
    </div>
  );
}

function DraftForm({ card, env }: { card: LedgerCard; env: Env }) {
  const { api, me, characters } = env;
  const { run, busy } = useAct(env.onNotice);
  const sheet = characters[card.characterId];
  const owner = me.id === card.actorId;
  const gm = me.role === 'gm';
  const canRanks = gm || (owner && card.speed === 'quick');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [concession, setConcession] = useState<ConcessionKind>(CONCESSION_KINDS[0]);
  const [manual, setManual] = useState({ source: 'preparation', what: 'skill:1', reason: '' });
  const [problem, setProblem] = useState<string | null>(null);
  const ranksChosen = !!card.difficulty && !!card.danger;
  /** Roll, Set and Discard say why on the card itself when the server refuses; the page banner is out of sight on a long card. */
  const act = (fn: () => Promise<unknown>) => { setProblem(null); return run(async () => { try { await fn(); } catch (e) { setProblem(e instanceof ApiFailure ? e.message : 'Something went wrong'); throw e; } }); };
  const key = JSON.stringify(card);
  useEffect(() => { api.preview(card.id).then(setPreview, () => setPreview(null)); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (patch: Parameters<GameApi['edit']>[1]) => run(() => api.edit(card.id, patch));
  const beliefOptions = [{ value: '', label: 'None' }, ...(sheet?.beliefs ?? []).map((b) => ({ value: b.id, label: `${b.isCore ? 'Core: ' : ''}${b.text}` }))];
  const others = Object.values(characters).filter((c) => c.id !== card.characterId);

  const addManual = () => {
    const [ladder, delta] = manual.what.split(':');
    save({ manualShifts: [...card.manualShifts, { ladder: ladder!, delta: Number(delta) as 1 | -1, source: manual.source, reason: manual.reason || manual.source }] });
    setManual({ ...manual, reason: '' });
  };

  return (
    <div className="draft">
      <TextField label="Want" testId="want" value={card.want} multiline disabled={!(owner || gm)} onCommit={(v) => save({ want: v })} />
      <TextField label="Risk" testId="risk" value={card.risk} multiline disabled={!(owner || gm)} onCommit={(v) => save({ risk: v })} />
      <SelectField label="On the line" testId="on-the-line" value={card.onTheLine ?? ''} options={beliefOptions} disabled={!(owner || gm)} onCommit={(v) => save({ onTheLine: v || null })} />
      <SelectField label="Backed by" testId="backing" value={card.backingBeliefId ?? ''} options={beliefOptions} disabled={!(owner || gm)} onCommit={(v) => save({ backingBeliefId: v || null })} />
      <SelectField label="The Danger falls on" testId="danger-target" value={card.dangerTargetId ?? ''} disabled={!(owner || gm)}
        options={[{ value: '', label: 'This character' }, ...others.map((c) => ({ value: c.id, label: c.name }))]} onCommit={(v) => save({ dangerTargetId: v || null })} />
      <TextField label="What the Danger is" testId="danger-text" value={card.dangerText} disabled={!(owner || gm)} onCommit={(v) => save({ dangerText: v })} />
      {card.onTheLine
        ? <p className="muted">A Belief is on the line, so the Danger is a Burden. You name it after the roll.</p>
        : <SelectField label="Kind of Danger" testId="danger-kind" value={card.dangerKind === 'burden' ? 'wound' : card.dangerKind} disabled={!(owner || gm)}
            options={[{ value: 'wound', label: 'A wound' }, { value: 'other', label: 'Something else (reputation, time, a lost ally)' }]} onCommit={(v) => save({ dangerKind: v as 'wound' | 'other' })} />}
      <SelectField label="Threat (for armor)" testId="threat" value={card.threat ?? ''} disabled={!(owner || gm)}
        options={[{ value: '', label: 'None' }, ...THREATS.map((t) => ({ value: t, label: t }))]} onCommit={(v) => save({ threat: v || null })} />
      <SelectField label="Difficulty" testId="difficulty" value={card.difficulty ?? ''} disabled={!canRanks}
        options={[{ value: '', label: card.speed === 'big' && !gm ? 'The GM sets this' : 'Choose…' }, ...DIFFICULTY_RANKS.filter((r) => r !== 'Trivial').map((r) => ({ value: r, label: r }))]} onCommit={(v) => save({ difficulty: v || null })} />
      <SelectField label="Danger" testId="danger" value={card.danger ?? ''} disabled={!canRanks}
        options={[{ value: '', label: card.speed === 'big' && !gm ? 'The GM sets this' : 'Choose…' }, ...DANGER_RANKS.map((r) => ({ value: r, label: DANGER_LABELS[r]! }))]} onCommit={(v) => save({ danger: v || null })} />
      {card.danger === 'Grave' && !card.onTheLine && card.dangerKind === 'wound' && (
        <label className="check"><input type="checkbox" data-testid="declared-mortal" checked={card.declaredMortal} disabled={!(owner || gm)} onChange={(e) => save({ declaredMortal: e.target.checked })} /> Declare this Danger Mortal (death is always telegraphed)</label>
      )}
      {gm && <label className="check"><input type="checkbox" data-testid="gm-big" checked={card.speed === 'big'} disabled={!!card.onTheLine} onChange={(e) => save({ gmMarkedBig: e.target.checked })} /> Big roll</label>}

      {preview && preview.candidates.length > 0 && (
        <fieldset className="chips" data-testid="shift-chips">
          <legend>Shifts from the sheet</legend>
          {preview.candidates.map((c) => (
            <button key={c.key} type="button" aria-pressed={card.shiftKeys.includes(c.key)} disabled={!(owner || gm)} data-testid={`shift-${c.key}`}
              onClick={() => save({ shiftKeys: card.shiftKeys.includes(c.key) ? card.shiftKeys.filter((k) => k !== c.key) : [...card.shiftKeys, c.key] })}>{c.label}</button>
          ))}
        </fieldset>
      )}
      <fieldset className="manual">
        <legend>Other shifts (agreed at Set)</legend>
        {card.manualShifts.map((m, i) => (
          <span key={i} className="chip-static">{m.source}: {m.ladder} {m.delta > 0 ? 'up' : 'down'}, {m.reason}
            <button type="button" aria-label="Remove shift" disabled={!(owner || gm)} onClick={() => save({ manualShifts: card.manualShifts.filter((_, j) => j !== i) })}>×</button></span>
        ))}
        {(owner || gm) && (
          <div className="row">
            <select aria-label="Source" value={manual.source} onChange={(e) => setManual({ ...manual, source: e.target.value })}>
              <option value="preparation">Preparation</option><option value="helping">Helping</option><option value="gear">Gear</option>
            </select>
            <select aria-label="Effect" value={manual.what} onChange={(e) => setManual({ ...manual, what: e.target.value })}>
              <option value="skill:1">Skill up</option><option value="difficulty:-1">Difficulty down</option><option value="danger:-1">Danger down</option>
            </select>
            <input aria-label="Reason" placeholder="Why" value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} />
            <button type="button" onClick={addManual}>Add</button>
          </div>
        )}
      </fieldset>

      {preview?.odds && <div data-testid="odds">Goal: <strong>{preview.odds.goal}</strong> · Danger: <strong>{preview.odds.danger}</strong></div>}
      {preview && preview.problems.length > 0 && <p className="muted" data-testid="problems">{preview.problems.join(' ')}</p>}

      <div className="actions">
        {owner && card.speed === 'quick' && <button disabled={busy} data-testid="roll" onClick={() => act(() => api.roll(card.id))}>Roll</button>}
        {gm && <button disabled={busy || !ranksChosen} data-testid="set" title={ranksChosen ? undefined : 'Choose a Difficulty and a Danger first'} onClick={() => act(() => api.set(card.id))}>Set</button>}
        {owner && <button type="button" disabled={busy} data-testid="discard" onClick={() => act(() => api.discard(card.id))}>Discard this card</button>}
        {owner && (
          <>
            <select aria-label="Concession" data-testid="concede-kind" value={concession} onChange={(e) => setConcession(e.target.value as ConcessionKind)}>{CONCESSION_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            <button disabled={busy} data-testid="concede" onClick={() => run(() => api.concede(card.id, concession))}>Concede</button>
          </>
        )}
      </div>
      {gm && !ranksChosen && <p className="muted">Choose a Difficulty and a Danger, then Set.</p>}
      {owner && card.speed === 'big' && <p className="muted">A big roll waits for the GM to Set it.</p>}
      {problem && <p role="alert" className="form-error" data-testid="card-problem">{problem}</p>}
    </div>
  );
}

function WrittenForm({ card, env }: { card: LedgerCard; env: Env }) {
  const { run, busy } = useAct(env.onNotice);
  const paras = myParagraphs(env.editor, env.me.id).filter((p) => !p.locked);
  const [para, setPara] = useState<string>('');
  const [woundName, setWoundName] = useState('');
  const [woundLevel, setWoundLevel] = useState<string>('');
  const [burdenName, setBurdenName] = useState('');
  const chosen = para || currentParagraph(env.editor, env.me.id) || paras.at(-1)?.id || '';
  const landed = !!card.dangerHit && !card.dangerTargetId;
  const wound = landed && card.dangerKind === 'wound' && !!card.worstWound;
  const burden = landed && !!card.onTheLine;
  const levels: WoundLevel[] = ['Hurt', 'Wounded', 'Critical', 'Mortal'];
  const allowed = card.worstWound ? levels.slice(0, levels.indexOf(card.worstWound) + 1) : [];
  return (
    <div className="written-form" data-testid="written-form">
      <h4>Write the outcome in the Story, then mark it</h4>
      <SelectField label="The outcome paragraph" testId="outcome-paragraph" value={chosen} onCommit={setPara}
        options={[{ value: '', label: paras.length ? 'Choose…' : 'Write a paragraph first' }, ...paras.map((p) => ({ value: p.id, label: p.text }))]} />
      {wound && (
        <>
          <label className="field"><span>Name the wound</span><input data-testid="wound-name" value={woundName} onChange={(e) => setWoundName(e.target.value)} placeholder={`${card.worstWound} wound`} /></label>
          <SelectField label="How bad (never worse than the Danger allows)" testId="wound-level" value={woundLevel || card.worstWound!} onCommit={setWoundLevel} options={allowed.map((l) => ({ value: l, label: l }))} />
        </>
      )}
      {burden && <label className="field"><span>Name the Burden</span><input data-testid="burden-name" value={burdenName} onChange={(e) => setBurdenName(e.target.value)} placeholder="a short phrase, e.g. Doubts the Oath" /></label>}
      <button data-testid="written" disabled={busy || !chosen} onClick={() => run(() => env.api.written(card.id, {
        outcomeParagraphId: chosen, ...(wound ? { woundName, woundLevel: woundLevel || card.worstWound! } : {}), ...(burden ? { burdenName } : {}),
      }))}>I've written the outcome</button>
    </div>
  );
}

function RolledView({ card, env }: { card: LedgerCard; env: Env }) {
  const { api, me } = env;
  const { run, busy } = useAct(env.onNotice);
  const [info, setInfo] = useState<PromptInfo | null>(null);
  const [concession, setConcession] = useState<ConcessionKind>(CONCESSION_KINDS[0]);
  const owner = me.id === card.actorId;
  const key = JSON.stringify([card.status, card.outcome, card.push, card.recheckRank]);
  useEffect(() => { api.prompt(card.id).then(setInfo, () => setInfo(null)); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="rolled">
      <Summary card={card} />
      {card.outcome && <div className="outcome" data-testid="outcome">{OUTCOME_LABELS[card.outcome]}</div>}
      {info?.prompt && (
        <div className="prompt">
          <p data-testid="prompt-headline">{info.prompt.headline}</p>
          {info.prompt.lines.map((l, i) => <p key={i}>{l}</p>)}
          {info.prompt.recheckNote && <p className="muted">{info.prompt.recheckNote}</p>}
        </div>
      )}
      {owner && info?.push.available && (
        <div className="actions">
          <button disabled={busy} data-testid="push-standard" onClick={() => run(() => api.push(card.id, 'standard'))}>Try again</button>
          <button disabled={busy || !info.push.conviction} data-testid="push-conviction" onClick={() => run(() => api.push(card.id, 'conviction'))}>Try again with Conviction</button>
          <select aria-label="Concession" data-testid="concede-kind" value={concession} onChange={(e) => setConcession(e.target.value as ConcessionKind)}>{CONCESSION_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          <button disabled={busy} data-testid="concede" onClick={() => run(() => api.concede(card.id, concession))}>Concede instead</button>
        </div>
      )}
      <DiceReveal card={card} env={env} />
      {owner && <WrittenForm card={card} env={env} />}
    </div>
  );
}

function ActiveCard({ card, env }: { card: LedgerCard; env: Env }) {
  const { api, me, characters } = env;
  const { run, busy } = useAct(env.onNotice);
  const owner = me.id === card.actorId;
  const [concession, setConcession] = useState<ConcessionKind>(CONCESSION_KINDS[0]);
  return (
    <article className="card" data-testid="card" id={`card-${card.id}`} data-card={card.id} data-status={card.status} data-speed={card.speed}>
      <header>
        <button type="button" className="linklike" data-testid="card-name" onClick={() => env.openCharacter(card.characterId)}><strong>{nameOf(characters, card.characterId)}</strong></button> · {card.skillName} <span className="badge" data-testid="card-speed">{card.speed === 'big' ? 'Big roll' : 'Quick roll'}</span>{' '}
        <span className="badge" data-testid="card-status">{STATUS_LABELS[card.status]}</span>
      </header>
      {card.status === 'draft' && <DraftForm card={card} env={env} />}
      {card.status === 'set' && (
        <>
          <Summary card={card} />
          <div className="actions">
            {(owner || me.role === 'gm') && <button disabled={busy} data-testid="roll" onClick={() => run(() => api.roll(card.id))}>Roll</button>}
            {owner && (
              <>
                <select aria-label="Concession" data-testid="concede-kind" value={concession} onChange={(e) => setConcession(e.target.value as ConcessionKind)}>{CONCESSION_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
                <button disabled={busy} data-testid="concede" onClick={() => run(() => api.concede(card.id, concession))}>Concede</button>
              </>
            )}
          </div>
        </>
      )}
      {card.status === 'rolled' && <RolledView card={card} env={env} />}
      {card.status === 'conceded' && (
        <div className="rolled">
          <p data-testid="conceded">Conceded: {card.concession}. Write the defeat; the GM cannot make it worse than the declared Danger.</p>
          {owner && <WrittenForm card={card} env={env} />}
        </div>
      )}
    </article>
  );
}

function PastRoll({ card, env, canRetcon }: { card: LedgerCard; env: Env; canRetcon: boolean }) {
  const { run, busy } = useAct(env.onNotice);
  return (
    <details className="card past" data-testid="past-roll">
      <summary>{nameOf(env.characters, card.characterId)} · {card.skillName} · {card.outcome ? OUTCOME_LABELS[card.outcome] : card.concession ? `Conceded: ${card.concession}` : STATUS_LABELS[card.status]}</summary>
      <p><em>{card.want}</em></p>
      {card.difficulty && <Summary card={card} />}
      <DiceReveal card={card} env={env} />
      {canRetcon && <button disabled={busy} data-testid="retcon" onClick={() => run(() => env.api.retcon(card.id))}>Retcon (GM)</button>}
    </details>
  );
}

function NewRoll({ env, character }: { env: Env; character: Character }) {
  const { run, busy } = useAct(env.onNotice);
  const [skill, setSkill] = useState(character.skills[0]?.name ?? '__other');
  const [other, setOther] = useState('');
  const name = skill === '__other' ? other.trim() : skill;
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="new-roll" data-testid="new-roll">
      <label className="field"><span>Skill</span>
        <select value={skill} data-testid="new-roll-skill" onChange={(e) => setSkill(e.target.value)}>
          {character.skills.map((s) => <option key={s.name} value={s.name}>{s.name} · {s.rank}</option>)}
          <option value="__other">Something else (Untrained)</option>
        </select>
      </label>
      {skill === '__other' && <input aria-label="Skill name" placeholder="What are you attempting?" value={other} onChange={(e) => setOther(e.target.value)} />}
      <button disabled={busy || !name} data-testid="new-roll-open" title="Opens a new card in the Ledger; it does not roll anything yet" onClick={() => { setProblem(null); run(async () => { try { await env.api.createCard({ skillName: name, anchorParagraphId: currentParagraph(env.editor, env.me.id) }); } catch (e) { setProblem(e instanceof ApiFailure ? e.message : 'Could not open a roll.'); throw e; } }); }}>Open a roll card</button>
      {problem && <span role="alert" className="form-error" data-testid="new-roll-problem">{problem}</span>}
    </div>
  );
}

export function Ledger({ cards, character, env }: { cards: LedgerCard[]; character: Character | null; env: Env }) {
  const active = cards.filter((c) => c.status !== 'written');
  const past = cards.filter((c) => c.status === 'written');
  const lastQuick = [...past].reverse().find((c) => c.speed === 'quick');
  return (
    <section aria-label="Ledger" data-testid="ledger">
      {character && env.me.role !== 'gm' && <NewRoll env={env} character={character} />}
      {active.length === 0 && <p className="muted">No roll in progress. Write up to the moment of action, then open a card.</p>}
      {active.map((c) => <ActiveCard key={c.id} card={c} env={env} />)}
      {past.length > 0 && <h3>Past rolls</h3>}
      {[...past].reverse().map((c) => <PastRoll key={c.id} card={c} env={env} canRetcon={env.me.role === 'gm' && c.id === lastQuick?.id} />)}
    </section>
  );
}
export type { Env as LedgerEnv };
