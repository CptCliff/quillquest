import { describe, expect, it } from 'vitest';
import {
  dockToEdge, PANELS, allowedPanels, defaultLayout, findGroup, hidePanel, movePanel, normalize, panelsIn, phoneOrder, presets, resizeSplit, sanitize, setActive, showPanel,
  validateLayout, type Group, type Layout, type Node, type PanelId, type Split,
} from '../src';

const groups = (n: Node): Group[] => (n.kind === 'group' ? [n] : n.children.flatMap(groups));
const splits = (n: Node): Split[] => (n.kind === 'group' ? [] : [n, ...n.children.flatMap(splits)]);
const all = (l: Layout) => [...panelsIn(l), ...l.hidden].sort();
const total = (s: Split) => s.sizes.reduce((a, b) => a + b, 0);

describe('the default layout', () => {
  it('is Story on the left and the notes panels stacked on the right, with Director only for the GM and Creation only for players', () => {
    const p = defaultLayout('player');
    expect(p.root.kind).toBe('split');
    const [story, notes] = groups(p.root);
    expect(story!.tabs).toEqual(['story']);
    expect(notes!.tabs).toEqual(['ledger', 'create', 'codex', 'roster']);
    expect((p.root as Split).sizes).toEqual([62, 38]);
    expect(allowedPanels('player')).not.toContain('director');
    expect(allowedPanels('player')).not.toContain('zero');
    expect(allowedPanels('gm')).toContain('zero');
    expect(allowedPanels('gm')).not.toContain('create');
    expect(defaultLayout('gm').root).toMatchObject({ kind: 'split' });
    expect(groups(defaultLayout('gm').root)[1]!.tabs).toEqual(['ledger', 'zero', 'codex', 'roster', 'director']);
    expect(allowedPanels('gm')).not.toContain('create');
  });
  it('accounts for every allowed panel exactly once: shown, or hidden (the info card starts hidden)', () => {
    for (const role of ['player', 'gm'] as const) {
      const l = defaultLayout(role);
      expect(all(l)).toEqual([...allowedPanels(role)].sort());
      expect(l.hidden).toContain('info');
    }
  });
});

describe('moving a panel', () => {
  it('onto the center of another group stacks it as a tab and makes it active', () => {
    const l = movePanel(defaultLayout('player'), 'ledger', findGroup(defaultLayout('player'), 'story')!.id, 'center');
    const story = findGroup(l, 'story')!;
    expect(story.tabs).toEqual(['story', 'ledger']);
    expect(story.active).toBe('ledger');
    expect(findGroup(l, 'codex')!.tabs).toEqual(['create', 'codex', 'roster']);
    expect(all(l)).toEqual(all(defaultLayout('player')));
  });
  it('to an edge splits the target group: left/right make a row, top/bottom a column, in the right order', () => {
    const base = defaultLayout('player');
    const target = findGroup(base, 'codex')!.id;
    const bottom = movePanel(base, 'roster', target, 'bottom');
    const notes = splits(bottom.root).find((s) => s.dir === 'col')!;
    expect(notes.children.map((c) => (c as Group).tabs)).toEqual([['ledger', 'create', 'codex'], ['roster']]);
    expect(total(notes)).toBeCloseTo(100);
    const left = movePanel(base, 'roster', findGroup(base, 'story')!.id, 'left');
    expect(groups(left.root).map((g) => g.tabs[0])).toEqual(['roster', 'story', 'ledger']);
    expect(left.root).toMatchObject({ kind: 'split', dir: 'row' });
    expect((left.root as Split).children).toHaveLength(3); // flattened into the existing row, not nested
    expect(total(left.root as Split)).toBeCloseTo(100);
    const top = movePanel(base, 'ledger', findGroup(base, 'story')!.id, 'top');
    expect(groups(top.root).map((g) => g.tabs[0])).toEqual(['ledger', 'story', 'create']);
  });
  it('moving the last tab out of a group removes the group, and moving a lone panel onto itself changes nothing', () => {
    const base = defaultLayout('player');
    const story = findGroup(base, 'story')!;
    expect(movePanel(base, 'story', story.id, 'right')).toEqual(base);
    expect(movePanel(base, 'story', story.id, 'center')).toEqual(base);
    const moved = movePanel(base, 'story', findGroup(base, 'ledger')!.id, 'center');
    expect(groups(moved.root)).toHaveLength(1); // the old Story group is gone and the split collapsed
    expect(moved.root.kind).toBe('group');
  });
  it('a hidden panel can be moved into view, and an unknown target is a no-op', () => {
    const base = defaultLayout('player');
    const l = movePanel(base, 'info', findGroup(base, 'story')!.id, 'right');
    expect(l.hidden).not.toContain('info');
    expect(panelsIn(l)).toContain('info');
    expect(movePanel(base, 'ledger', 'nope', 'center')).toEqual(base);
  });
});

describe('docking to an edge of the whole workspace', () => {
  it('puts a panel along the left, right, top or bottom of everything, taking about a third of the room', () => {
    const base = defaultLayout('player');
    const right = dockToEdge(base, 'roster', 'right');
    expect(groups(right.root).map((g) => g.tabs[0])).toEqual(['story', 'ledger', 'roster']); // joins the existing row
    expect(total(right.root as Split)).toBeCloseTo(100);
    expect((right.root as Split).sizes[2]).toBeCloseTo(30);
    const left = dockToEdge(base, 'ledger', 'left');
    expect(groups(left.root).map((g) => g.tabs[0])).toEqual(['ledger', 'story', 'create']);
    const bottom = dockToEdge(base, 'codex', 'bottom');
    expect(bottom.root).toMatchObject({ kind: 'split', dir: 'col' });
    expect(((bottom.root as Split).children[1] as Group).tabs).toEqual(['codex']);
    const top = dockToEdge(base, 'codex', 'top');
    expect(((top.root as Split).children[0] as Group).tabs).toEqual(['codex']);
    for (const l of [right, left, bottom, top]) expect(all(l)).toEqual(all(base));
  });
  it('a hidden panel can be docked, and a lone Story with nothing else is left alone', () => {
    const base = defaultLayout('player');
    expect(panelsIn(dockToEdge(base, 'info', 'bottom'))).toContain('info');
    expect(dockToEdge(presets.focus('player'), 'story', 'left')).toEqual(presets.focus('player'));
  });
});

describe('resizing', () => {
  it('moves the divider between two neighbours, keeps the total, and never squeezes a pane below the minimum', () => {
    const base = defaultLayout('player');
    const split = base.root as Split;
    const l = resizeSplit(base, split.id, 0, 10);
    expect((l.root as Split).sizes).toEqual([72, 28]);
    expect(total(l.root as Split)).toBe(100);
    const far = resizeSplit(base, split.id, 0, 500);
    expect((far.root as Split).sizes[1]).toBeGreaterThanOrEqual(10);
    const farLeft = resizeSplit(base, split.id, 0, -500);
    expect((farLeft.root as Split).sizes[0]).toBeGreaterThanOrEqual(10);
    expect(resizeSplit(base, 'nope', 0, 5)).toEqual(base);
    expect(resizeSplit(base, split.id, 5, 5)).toEqual(base);
  });
});

describe('tabs, hiding and showing', () => {
  it('setActive picks a tab; hiding removes a panel from view (never Story) and showing puts it back as a tab beside the notes', () => {
    const base = defaultLayout('player');
    expect(findGroup(setActive(base, 'roster'), 'roster')!.active).toBe('roster');
    const h = hidePanel(base, 'codex');
    expect(h.hidden).toContain('codex');
    expect(panelsIn(h)).not.toContain('codex');
    expect(hidePanel(base, 'story')).toEqual(base);
    const s = showPanel(h, 'codex');
    expect(findGroup(s, 'codex')!.tabs).toContain('ledger');
    expect(findGroup(s, 'codex')!.active).toBe('codex');
    expect(s.hidden).not.toContain('codex');
  });
  it('hiding every notes panel leaves Story alone, and showing one again brings the notes back on the right', () => {
    let l = defaultLayout('player');
    for (const p of ['ledger', 'create', 'codex', 'roster'] as PanelId[]) l = hidePanel(l, p);
    expect(l.root.kind).toBe('group');
    l = showPanel(l, 'ledger');
    expect(l.root).toMatchObject({ kind: 'split', dir: 'row' });
    expect(groups(l.root).map((g) => g.tabs[0])).toEqual(['story', 'ledger']);
  });
  it('the info card is shown beside the Ledger when it is opened', () => {
    const l = showPanel(defaultLayout('player'), 'info');
    expect(findGroup(l, 'info')!.tabs).toContain('ledger');
  });
});

describe('normalize', () => {
  it('drops empty groups, collapses one-child splits, repairs sizes and a bad active tab, and is idempotent', () => {
    const messy: Layout = {
      v: 1, hidden: ['info'],
      root: { kind: 'split', id: 's1', dir: 'row', sizes: [30, 30, 30], children: [
        { kind: 'group', id: 'g1', tabs: ['story'], active: 'ledger' },
        { kind: 'group', id: 'g2', tabs: [], active: 'story' },
        { kind: 'split', id: 's2', dir: 'row', sizes: [100], children: [{ kind: 'group', id: 'g3', tabs: ['ledger'], active: 'ledger' }] },
      ] },
    };
    const n = normalize(messy);
    expect(groups(n.root).map((g) => g.id)).toEqual(['g1', 'g3']);
    expect((n.root as Split).sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
    expect(findGroup(n, 'story')!.active).toBe('story');
    expect(normalize(n)).toEqual(n);
  });
});

describe('presets', () => {
  it('Reading puts the notes below, Writer\'s focus shows only Story, Swap sides puts the notes on the left, Classic is the default', () => {
    const r = presets.reading('player');
    expect(r.root).toMatchObject({ kind: 'split', dir: 'col' });
    const f = presets.focus('player');
    expect(f.root.kind).toBe('group');
    expect(f.hidden).toEqual(expect.arrayContaining(['ledger', 'codex', 'roster']));
    const s = presets.swap('player');
    expect(groups(s.root).map((g) => g.tabs[0])).toEqual(['ledger', 'story']);
    expect(presets.classic('gm')).toEqual(defaultLayout('gm'));
    for (const role of ['player', 'gm'] as const) for (const k of ['classic', 'reading', 'focus', 'swap'] as const) {
      const l = presets[k](role);
      expect(all(l)).toEqual([...allowedPanels(role)].sort());
      expect(validateLayout(l, role).ok).toBe(true);
    }
  });
});

describe('validation and sanitising (what the server accepts)', () => {
  const ok = defaultLayout('player');
  it('accepts a good layout and returns it normalised', () => {
    const r = validateLayout(JSON.parse(JSON.stringify(ok)), 'player');
    expect(r).toEqual({ ok: true, layout: ok });
  });
  it('rejects what is malformed: wrong version, unknown or repeated panels, no Story, bad sizes, huge or deep trees, a non-object', () => {
    const bad = (x: unknown) => expect(validateLayout(x, 'player').ok, JSON.stringify(x).slice(0, 80)).toBe(false);
    bad(null); bad('x'); bad({ v: 2, root: ok.root, hidden: [] }); bad({ v: 1, hidden: [] }); bad({ v: 1, root: ok.root });
    bad({ ...ok, hidden: [...ok.hidden, 'ledger'] }); // ledger is both shown and hidden
    bad({ ...ok, hidden: [...ok.hidden, 'bogus'] });
    bad({ ...ok, root: { kind: 'group', id: 'g1', tabs: ['ledger', 'ledger', 'story'], active: 'story' } });
    bad({ v: 1, hidden: [], root: { kind: 'group', id: 'g1', tabs: ['ledger'], active: 'ledger' } }); // Story must be in view
    bad({ v: 1, hidden: [], root: { kind: 'split', id: 's', dir: 'diagonal', sizes: [50, 50], children: [] } });
    bad({ ...ok, root: { ...(ok.root as Split), sizes: [50] } });
    bad({ ...ok, root: { ...(ok.root as Split), sizes: [-10, 110] } });
    let deep: Node = { kind: 'group', id: 'g0', tabs: ['story'], active: 'story' };
    for (let i = 0; i < 12; i++) deep = { kind: 'split', id: `s${i}`, dir: i % 2 ? 'row' : 'col', sizes: [50, 50], children: [deep, { kind: 'group', id: `x${i}`, tabs: [], active: 'story' }] };
    bad({ v: 1, hidden: [], root: deep });
    bad({ ...ok, root: { kind: 'group', id: 'g'.repeat(100), tabs: ['story'], active: 'story' } });
  });
  it('a player\'s layout can never carry the Director, and a GM\'s can never carry Creation; sanitising removes them and keeps everything else', () => {
    const withDirector = movePanel(defaultLayout('gm'), 'director', findGroup(defaultLayout('gm'), 'story')!.id, 'center');
    expect(validateLayout(withDirector, 'player').ok).toBe(false);
    const clean = sanitize(withDirector, 'player');
    expect(all(clean)).toEqual([...allowedPanels('player')].sort());
    expect(validateLayout(clean, 'player').ok).toBe(true);
    expect(panelsIn(clean)).toContain('story');
    expect(sanitize(defaultLayout('player'), 'gm')).toBeTruthy();
    expect(validateLayout(sanitize(defaultLayout('player'), 'gm'), 'gm').ok).toBe(true);
  });
});

describe('the phone', () => {
  it('shows the same panels as one ordered list after Story, so a person\'s arrangement is honoured', () => {
    expect(phoneOrder(defaultLayout('player'), 'player')).toEqual(['ledger', 'create', 'codex', 'roster']);
    const swapped = phoneOrder(presets.swap('gm'), 'gm');
    expect(swapped).toEqual(['ledger', 'zero', 'codex', 'roster', 'director']);
    expect(phoneOrder(presets.focus('player'), 'player')).toEqual([]);
  });
});

describe('no operation ever loses or duplicates a panel', () => {
  it('holds across thousands of random moves, resizes, hides and shows', () => {
    let seed = 12345;
    const rnd = (n: number) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
    for (const role of ['player', 'gm'] as const) {
      let l = defaultLayout(role);
      const want = [...allowedPanels(role)].sort();
      const zones = ['center', 'left', 'right', 'top', 'bottom'] as const;
      for (let i = 0; i < 1500; i++) {
        const panel = want[rnd(want.length)] as PanelId;
        const gs = groups(l.root);
        const op = rnd(6);
        if (op === 0) l = movePanel(l, panel, gs[rnd(gs.length)]!.id, zones[rnd(5)]!);
        else if (op === 1) { const ss = splits(l.root); if (ss.length) { const s = ss[rnd(ss.length)]!; l = resizeSplit(l, s.id, rnd(s.children.length), rnd(41) - 20); } }
        else if (op === 2) l = hidePanel(l, panel);
        else if (op === 3) l = showPanel(l, panel);
        else if (op === 5) l = dockToEdge(l, panel, (['left', 'right', 'top', 'bottom'] as const)[rnd(4)]!);
        else l = setActive(l, panel);
        expect(all(l), `step ${i}`).toEqual(want);
        expect(panelsIn(l)).toContain('story');
        expect(normalize(l)).toEqual(l);
        for (const s of splits(l.root)) { expect(total(s)).toBeCloseTo(100); expect(s.sizes.every((x) => x >= 8)).toBe(true); expect(s.children.length).toBeGreaterThanOrEqual(2); }
        for (const g of groups(l.root)) { expect(g.tabs.length).toBeGreaterThan(0); expect(g.tabs).toContain(g.active); }
        if (i % 100 === 0) { const v = validateLayout(JSON.parse(JSON.stringify(l)), role); expect(v.ok ? 'ok' : (v as { error: string }).error, `step ${i}`).toBe('ok'); }
      }
    }
  });
  it('lists every panel the app knows', () => {
    expect([...PANELS].sort()).toEqual(['codex', 'create', 'director', 'info', 'ledger', 'roster', 'story', 'zero']);
  });
});

describe('the GM\'s Session zero panel', () => {
  it('a saved layout from before it existed gains it as a hidden panel, and the GM can show it', () => {
    const old = JSON.parse(JSON.stringify(defaultLayout('gm')));
    old.root.children[1].tabs = ['ledger', 'codex', 'roster', 'director'];
    old.root.children[1].active = 'ledger';
    old.hidden = [];
    const fixed = sanitize(old, 'gm');
    expect(fixed.hidden).toContain('zero');
    expect(panelsIn(showPanel(fixed, 'zero'))).toContain('zero');
  });
  it('is refused for a player, on read and on write', () => {
    expect(validateLayout(defaultLayout('gm'), 'player').ok).toBe(false);
    expect(panelsIn(sanitize(defaultLayout('gm'), 'player'))).not.toContain('zero');
  });
});
