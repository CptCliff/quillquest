// The table's workspace as pure data (interface design pass). A layout is a tree of splits and tabbed groups of panels, plus the panels
// currently hidden. Every operation returns a new layout and never loses or duplicates a panel; `validateLayout` is what the server accepts.

export const PANELS = ['story', 'ledger', 'create', 'codex', 'roster', 'director', 'info'] as const;
export type PanelId = (typeof PANELS)[number];
export type Role = 'player' | 'gm';
export type Zone = 'center' | 'left' | 'right' | 'top' | 'bottom';

export interface Group { kind: 'group'; id: string; tabs: PanelId[]; active: PanelId }
export interface Split { kind: 'split'; id: string; dir: 'row' | 'col'; children: Node[]; sizes: number[] }
export type Node = Group | Split;
export interface Layout { v: 1; root: Node; hidden: PanelId[] }

/** Smallest share of a split a pane may be dragged to, and the smallest normalising will allow. */
export const MIN_DRAG = 10;
export const MIN_SIZE = 8;
const MAX_DEPTH = 8;
const MAX_GROUPS = 12;
const MAX_BYTES = 8000;

/** The Director is the GM's; Creation is the player's. Everything else is shared. */
export const allowedPanels = (role: Role): PanelId[] => (role === 'gm' ? ['story', 'ledger', 'codex', 'roster', 'director', 'info'] : ['story', 'ledger', 'create', 'codex', 'roster', 'info']);
const NOTES: Record<Role, PanelId[]> = { player: ['ledger', 'create', 'codex', 'roster'], gm: ['ledger', 'codex', 'roster', 'director'] };

// ---------- reading ----------
const walk = (n: Node, f: (n: Node) => void) => { f(n); if (n.kind === 'split') n.children.forEach((c) => walk(c, f)); };
const groupsOf = (n: Node): Group[] => (n.kind === 'group' ? [n] : n.children.flatMap(groupsOf));
/** Panels in view, left to right and top to bottom, tab by tab. */
export const panelsIn = (l: Layout): PanelId[] => groupsOf(l.root).flatMap((g) => g.tabs);
export const findGroup = (l: Layout, panel: PanelId): Group | undefined => groupsOf(l.root).find((g) => g.tabs.includes(panel));
const groupById = (l: Layout, id: string): Group | undefined => groupsOf(l.root).find((g) => g.id === id);

function nextId(l: Layout, prefix: 'g' | 's'): string {
  let max = 0;
  walk(l.root, (n) => { const m = /^[gs](\d+)$/.exec(n.id); if (m && n.id[0] === prefix) max = Math.max(max, Number(m[1])); });
  return `${prefix}${max + 1}`;
}

// ---------- normalising ----------
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const sizesOk = (a: number[]) => Math.abs(a.reduce((x, y) => x + y, 0) - 100) < 1e-4 && a.every((x) => x >= MIN_SIZE - 1e-9);
function fixSizes(sizes: number[], n: number): number[] {
  const s = sizes.length === n && sizes.every((x) => Number.isFinite(x) && x > 0) ? sizes : Array.from({ length: n }, () => 100 / n);
  // Anything under the minimum is pinned to it; the rest share what is left in proportion.
  const pinned = new Set<number>();
  let out = s;
  for (let guard = 0; guard <= n; guard++) {
    const free = s.map((_, i) => i).filter((i) => !pinned.has(i));
    const remaining = 100 - pinned.size * MIN_SIZE;
    const sumFree = free.reduce((a, i) => a + s[i]!, 0);
    out = s.map((x, i) => (pinned.has(i) ? MIN_SIZE : (x * remaining) / sumFree));
    const low = free.filter((i) => out[i]! < MIN_SIZE);
    if (!low.length) break;
    low.forEach((i) => pinned.add(i));
  }
  return out.map(round);
}

function tidy(n: Node): Node | null {
  if (n.kind === 'group') {
    const tabs = [...new Set(n.tabs)];
    if (!tabs.length) return null;
    if (tabs.length === n.tabs.length && n.tabs.includes(n.active)) return n;
    return { ...n, tabs, active: tabs.includes(n.active) ? n.active : tabs[0]! };
  }
  const kids: { node: Node; size: number }[] = [];
  n.children.forEach((c, i) => {
    const t = tidy(c);
    if (!t) return;
    const size = n.sizes[i] ?? 100 / n.children.length;
    if (t.kind === 'split' && t.dir === n.dir) t.children.forEach((cc, j) => kids.push({ node: cc, size: (size * (t.sizes[j] ?? 0)) / 100 })); // flatten a nested split of the same direction
    else kids.push({ node: t, size });
  });
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0]!.node;
  const unchanged = kids.length === n.children.length && kids.every((k, i) => k.node === n.children[i]);
  if (unchanged && n.sizes.length === kids.length && sizesOk(n.sizes)) return n; // already tidy: leave the numbers exactly as they are
  const total = kids.reduce((a, k) => a + k.size, 0) || 1;
  return { ...n, children: kids.map((k) => k.node), sizes: fixSizes(kids.map((k) => (k.size * 100) / total), kids.length) };
}

/** Drops empty groups, collapses and flattens splits, repairs sizes and active tabs. Idempotent. */
export function normalize(l: Layout): Layout {
  const root = tidy(l.root) ?? { kind: 'group', id: 'g1', tabs: ['story'], active: 'story' };
  const shown = new Set(groupsOf(root).flatMap((g) => g.tabs));
  const hidden = [...new Set(l.hidden)].filter((p) => !shown.has(p));
  const same = root === l.root && hidden.length === l.hidden.length && hidden.every((p, i) => p === l.hidden[i]);
  return same ? l : { v: 1, root, hidden };
}

// ---------- operations ----------
function mapGroups(n: Node, f: (g: Group) => Group): Node {
  return n.kind === 'group' ? f(n) : { ...n, children: n.children.map((c) => mapGroups(c, f)) };
}
const detach = (l: Layout, panel: PanelId): Layout => ({
  v: 1, hidden: l.hidden.filter((p) => p !== panel),
  root: mapGroups(l.root, (g) => (g.tabs.includes(panel) ? { ...g, tabs: g.tabs.filter((t) => t !== panel), active: g.active === panel ? (g.tabs.find((t) => t !== panel) ?? g.active) : g.active } : g)),
});

/** Put a new group beside `targetId` (inside its parent when the direction matches, otherwise by splitting it). */
function insertBeside(l: Layout, targetId: string, group: Group, zone: Exclude<Zone, 'center'>, sizeSplit = 50): Layout {
  const dir: 'row' | 'col' = zone === 'left' || zone === 'right' ? 'row' : 'col';
  const before = zone === 'left' || zone === 'top';
  const splitId = nextId(l, 's');
  const go = (n: Node): Node => {
    if (n.kind === 'group') {
      if (n.id !== targetId) return n;
      return { kind: 'split', id: splitId, dir, sizes: [sizeSplit, 100 - sizeSplit], children: before ? [group, n] : [n, group] };
    }
    const at = n.children.findIndex((c) => c.kind === 'group' && c.id === targetId);
    if (at >= 0 && n.dir === dir) {
      const half = n.sizes[at]! / 2;
      const sizes = [...n.sizes];
      sizes[at] = n.sizes[at]! - half;
      const insertAt = before ? at : at + 1;
      sizes.splice(insertAt, 0, half);
      const children = [...n.children];
      children.splice(insertAt, 0, group);
      return { ...n, children, sizes };
    }
    return { ...n, children: n.children.map(go) };
  };
  return { ...l, root: go(l.root) };
}

/** Moves a panel (shown or hidden) onto the center of a group (as a tab) or to one of its edges (a new pane). */
export function movePanel(l: Layout, panel: PanelId, targetGroupId: string, zone: Zone): Layout {
  if (!PANELS.includes(panel)) return l;
  const target = groupById(l, targetGroupId);
  if (!target) return l;
  const src = findGroup(l, panel);
  if (src && src.id === target.id && src.tabs.length === 1) return l;
  if (src && src.id === target.id && zone === 'center') return setActive(l, panel);
  const rest = detach(l, panel);
  let out: Layout;
  if (zone === 'center') out = { ...rest, root: mapGroups(rest.root, (g) => (g.id === target.id ? { ...g, tabs: [...g.tabs.filter((t) => t !== panel), panel], active: panel } : g)) };
  else out = insertBeside(rest, target.id, { kind: 'group', id: nextId(rest, 'g'), tabs: [panel], active: panel }, zone);
  return normalize(out);
}

/** Moves the divider after child `index` of a split by `delta` percent, never squeezing either neighbour below the minimum. */
export function resizeSplit(l: Layout, splitId: string, index: number, delta: number): Layout {
  let changed = false;
  const go = (n: Node): Node => {
    if (n.kind === 'group') return n;
    if (n.id === splitId) {
      if (!Number.isInteger(index) || index < 0 || index > n.children.length - 2) return n;
      const a = n.sizes[index]!; const b = n.sizes[index + 1]!;
      const lo = MIN_DRAG - a; const hi = b - MIN_DRAG;
      if (lo > hi) return n;
      const d = Math.min(Math.max(delta, lo), hi);
      if (d === 0) return n;
      const sizes = [...n.sizes]; sizes[index] = a + d; sizes[index + 1] = b - d;
      changed = true;
      return { ...n, sizes };
    }
    const children = n.children.map(go);
    return children.every((c, i) => c === n.children[i]) ? n : { ...n, children };
  };
  const root = go(l.root);
  return changed ? { ...l, root } : l;
}

export function setActive(l: Layout, panel: PanelId): Layout {
  if (l.hidden.includes(panel)) return showPanel(l, panel);
  if (!findGroup(l, panel)) return l;
  return { ...l, root: mapGroups(l.root, (g) => (g.tabs.includes(panel) && g.active !== panel ? { ...g, active: panel } : g)) };
}

/** Hides a panel. Story cannot be hidden. */
export function hidePanel(l: Layout, panel: PanelId): Layout {
  if (panel === 'story' || l.hidden.includes(panel) || !findGroup(l, panel)) return l;
  const d = detach(l, panel);
  return normalize({ ...d, hidden: [...d.hidden, panel] });
}

/** Brings a hidden panel back as a tab beside the notes (or as a new pane on the right when only Story is showing). */
export function showPanel(l: Layout, panel: PanelId): Layout {
  if (!l.hidden.includes(panel)) return findGroup(l, panel) ? setActive(l, panel) : l;
  const rest: Layout = { ...l, hidden: l.hidden.filter((p) => p !== panel) };
  const anchor = groupsOf(rest.root).find((g) => g.tabs.some((t) => t !== 'story'));
  if (anchor) return { ...rest, root: mapGroups(rest.root, (g) => (g.id === anchor.id ? { ...g, tabs: [...g.tabs, panel], active: panel } : g)) };
  const storyGroup = findGroup(rest, 'story')!;
  return normalize(insertBeside(rest, storyGroup.id, { kind: 'group', id: nextId(rest, 'g'), tabs: [panel], active: panel }, 'right', 62));
}

// ---------- defaults and presets ----------
const group = (id: string, tabs: PanelId[]): Group => ({ kind: 'group', id, tabs, active: tabs[0]! });
const hiddenFor = (role: Role, shown: PanelId[]): PanelId[] => allowedPanels(role).filter((p) => !shown.includes(p));

export const defaultLayout = (role: Role): Layout => ({
  v: 1, hidden: hiddenFor(role, ['story', ...NOTES[role]]),
  root: { kind: 'split', id: 's1', dir: 'row', sizes: [62, 38], children: [group('g1', ['story']), group('g2', NOTES[role])] },
});
export const presets = {
  classic: defaultLayout,
  reading: (role: Role): Layout => ({ v: 1, hidden: hiddenFor(role, ['story', ...NOTES[role]]), root: { kind: 'split', id: 's1', dir: 'col', sizes: [65, 35], children: [group('g1', ['story']), group('g2', NOTES[role])] } }),
  focus: (role: Role): Layout => ({ v: 1, hidden: hiddenFor(role, ['story']), root: group('g1', ['story']) }),
  swap: (role: Role): Layout => ({ v: 1, hidden: hiddenFor(role, ['story', ...NOTES[role]]), root: { kind: 'split', id: 's1', dir: 'row', sizes: [38, 62], children: [group('g2', NOTES[role]), group('g1', ['story'])] } }),
};

/** Removes panels this role may not have, accounts for any that are missing (as hidden), and tidies. Falls back to the default if Story is gone. */
export function sanitize(l: Layout, role: Role): Layout {
  const ok = new Set(allowedPanels(role));
  const root = tidy(mapGroups(l.root, (g) => ({ ...g, tabs: g.tabs.filter((t) => ok.has(t)) })));
  if (!root || !groupsOf(root).some((g) => g.tabs.includes('story'))) return defaultLayout(role);
  const shown = new Set(groupsOf(root).flatMap((g) => g.tabs));
  const hidden = [...new Set(l.hidden)].filter((p) => ok.has(p) && !shown.has(p));
  for (const p of allowedPanels(role)) if (!shown.has(p) && !hidden.includes(p)) hidden.push(p);
  return normalize({ v: 1, root, hidden });
}

/** On a phone the panels are one ordered list of tabs after Story, in the order the person arranged them. */
export const phoneOrder = (l: Layout, _role: Role): PanelId[] => panelsIn(l).filter((p) => p !== 'story' && p !== 'info');

// ---------- validation ----------
export type Validation = { ok: true; layout: Layout } | { ok: false; error: string };
const bad = (error: string): Validation => ({ ok: false, error });
const isPanel = (x: unknown): x is PanelId => typeof x === 'string' && (PANELS as readonly string[]).includes(x);
const ID = /^[a-z0-9-]{1,24}$/;

/** What the server accepts from a client: strict shape, known and unique panels, Story in view, bounded size and depth. */
export function validateLayout(x: unknown, role?: Role): Validation {
  if (!x || typeof x !== 'object') return bad('A layout is an object');
  const l = x as Record<string, unknown>;
  if (l.v !== 1) return bad('Unknown layout version');
  if (!Array.isArray(l.hidden) || !l.hidden.every(isPanel)) return bad('hidden must be a list of panels');
  if (!l.root || typeof l.root !== 'object') return bad('A layout needs a root');
  try { if (JSON.stringify(x).length > MAX_BYTES) return bad('That layout is too large'); } catch { return bad('Unreadable layout'); }
  const ids = new Set<string>(); const seen: PanelId[] = []; let groups = 0;
  const check = (n: unknown, depth: number): string | null => {
    if (depth > MAX_DEPTH) return 'That layout is nested too deeply';
    if (!n || typeof n !== 'object') return 'Bad node';
    const o = n as Record<string, unknown>;
    if (typeof o.id !== 'string' || !ID.test(o.id) || ids.has(o.id)) return 'Bad or repeated id';
    ids.add(o.id);
    if (o.kind === 'group') {
      if (++groups > MAX_GROUPS) return 'Too many groups';
      if (!Array.isArray(o.tabs) || !o.tabs.length || !o.tabs.every(isPanel)) return 'A group needs tabs of known panels';
      if (!o.tabs.includes(o.active as PanelId)) return 'A group\'s active tab must be one of its tabs';
      seen.push(...(o.tabs as PanelId[]));
      return null;
    }
    if (o.kind !== 'split') return 'Unknown node kind';
    if (o.dir !== 'row' && o.dir !== 'col') return 'A split runs row or col';
    if (!Array.isArray(o.children) || o.children.length < 2 || !Array.isArray(o.sizes) || o.sizes.length !== o.children.length) return 'A split needs two or more children and one size each';
    if (!o.sizes.every((s) => typeof s === 'number' && Number.isFinite(s) && s > 0)) return 'Sizes must be positive numbers';
    for (const c of o.children) { const e = check(c, depth + 1); if (e) return e; }
    return null;
  };
  const err = check(l.root, 1);
  if (err) return bad(err);
  const all = [...seen, ...(l.hidden as PanelId[])];
  if (new Set(all).size !== all.length) return bad('A panel appears twice');
  if (!seen.includes('story')) return bad('Story must stay in view');
  if (role) { const ok = new Set(allowedPanels(role)); if (all.some((p) => !ok.has(p))) return bad('That layout has a panel this role may not have'); }
  return { ok: true, layout: normalize(l as unknown as Layout) };
}
