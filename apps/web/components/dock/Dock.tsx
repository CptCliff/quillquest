'use client';
import { Fragment, useRef, useState } from 'react';
import { MIN_DRAG, dockToEdge, findGroup, hidePanel, movePanel, panelsIn, resizeSplit, setActive, type Group, type Layout, type Node, type PanelId, type Split, type Zone } from '@quillquest/layout';
import { Menu, type MenuItem } from './Menu';
import { Slot } from './PanelHost';

export interface DockProps {
  layout: Layout;
  /** What each tab says (an attention dot included). */
  labels: Record<PanelId, string>;
  /** Apply a change to the layout, with a sentence to announce to screen readers. */
  onChange: (fn: (l: Layout) => Layout, announce?: string) => void;
}

const EDGE = 0.28;
function zoneFor(r: DOMRect, x: number, y: number): Zone {
  const fx = (x - r.left) / r.width; const fy = (y - r.top) / r.height;
  const d: [Zone, number][] = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]];
  const [zone, dist] = d.reduce((a, b) => (b[1] < a[1] ? b : a));
  return dist < EDGE ? zone : 'center';
}

/** The workspace: splits with draggable, keyboard-operable dividers; groups of tabs; drag a tab onto a group's centre or edge to move it. */
export function Dock({ layout, labels, onChange }: DockProps) {
  const groupEls = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<{ panel: PanelId; x: number; y: number; target: { id: string; zone: Zone } | null } | null>(null);
  const suppressClick = useRef(false);

  const hit = (x: number, y: number) => {
    for (const [id, el] of groupEls.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { id, zone: zoneFor(r, x, y) };
    }
    return null;
  };
  const describe = (panel: PanelId, t: { id: string; zone: Zone }) => {
    const g = groupOf(t.id);
    const where = g ? labels[g.tabs.find((p) => p !== panel) ?? g.tabs[0]!] : 'the workspace';
    return t.zone === 'center' ? `${labels[panel]} stacked with ${where}` : `${labels[panel]} moved to the ${t.zone} of ${where}`;
  };
  const groupOf = (id: string): Group | undefined => {
    let found: Group | undefined;
    const walk = (n: Node) => { if (n.kind === 'group') { if (n.id === id) found = n; } else n.children.forEach(walk); };
    walk(layout.root);
    return found;
  };

  const startDrag = (panel: PanelId, e: React.PointerEvent) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const sx = e.clientX; const sy = e.clientY;
    let active = false;
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      active = true;
      setDrag({ panel, x: ev.clientX, y: ev.clientY, target: hit(ev.clientX, ev.clientY) });
    };
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', key); };
    const up = (ev: PointerEvent) => {
      end();
      if (!active) return;
      suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0);
      const t = hit(ev.clientX, ev.clientY);
      setDrag(null);
      if (t) onChange((l) => movePanel(l, panel, t.id, t.zone), describe(panel, t));
    };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { end(); setDrag(null); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('keydown', key);
  };

  const ctx: Ctx = { layout, labels, onChange, groupEls: groupEls.current, drag, startDrag, suppressClick };
  return (
    <div className="dock" data-testid="dock" data-dragging={drag ? 'true' : undefined}>
      <NodeView node={layout.root} ctx={ctx} />
      {drag && <div className="dock-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }} aria-hidden="true">{labels[drag.panel]}</div>}
    </div>
  );
}

interface Ctx {
  layout: Layout; labels: Record<PanelId, string>; onChange: DockProps['onChange'];
  groupEls: Map<string, HTMLElement>;
  drag: { panel: PanelId; target: { id: string; zone: Zone } | null } | null;
  startDrag: (panel: PanelId, e: React.PointerEvent) => void;
  suppressClick: { current: boolean };
}

function NodeView({ node, ctx }: { node: Node; ctx: Ctx }) {
  return node.kind === 'group' ? <GroupView group={node} ctx={ctx} /> : <SplitView split={node} ctx={ctx} />;
}

function SplitView({ split, ctx }: { split: Split; ctx: Ctx }) {
  const ref = useRef<HTMLDivElement>(null);
  const nameOf = (n: Node): string => (n.kind === 'group' ? ctx.labels[n.active] : nameOf(n.children[0]!));
  return (
    <div ref={ref} className="dock-split" data-dir={split.dir} data-split={split.id}>
      {split.children.map((c, i) => (
        <Fragment key={c.id}>
          <div className="dock-cell" style={{ flex: `${split.sizes[i]} 1 0%` }}><NodeView node={c} ctx={ctx} /></div>
          {i < split.children.length - 1 && (
            <Splitter split={split} index={i} container={ref} a={nameOf(c)} b={nameOf(split.children[i + 1]!)} ctx={ctx} />
          )}
        </Fragment>
      ))}
    </div>
  );
}

/** The divider between two panes: drag it, or focus it and use the arrow keys (Shift for bigger steps, Home and End for the extremes). */
function Splitter({ split, index, container, a, b, ctx }: { split: Split; index: number; container: React.RefObject<HTMLDivElement | null>; a: string; b: string; ctx: Ctx }) {
  const row = split.dir === 'row';
  const size = split.sizes[index]!;
  const max = size + split.sizes[index + 1]! - MIN_DRAG;
  const nudge = (delta: number) => ctx.onChange((l) => resizeSplit(l, split.id, index, delta));
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    let last = row ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      const rect = container.current!.getBoundingClientRect();
      const pos = row ? ev.clientX : ev.clientY;
      const delta = ((pos - last) / (row ? rect.width : rect.height)) * 100;
      last = pos;
      if (delta) nudge(delta);
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    const back = row ? 'ArrowLeft' : 'ArrowUp'; const fwd = row ? 'ArrowRight' : 'ArrowDown';
    if (e.key === back) { e.preventDefault(); nudge(-step); }
    else if (e.key === fwd) { e.preventDefault(); nudge(step); }
    else if (e.key === 'Home') { e.preventDefault(); nudge(-100); }
    else if (e.key === 'End') { e.preventDefault(); nudge(100); }
  };
  return (
    <div className="dock-splitter" role="separator" tabIndex={0} data-testid="splitter" data-dir={split.dir}
      aria-orientation={row ? 'vertical' : 'horizontal'} aria-label={`Resize ${a} and ${b}`} aria-valuenow={Math.round(size)} aria-valuemin={MIN_DRAG} aria-valuemax={Math.round(max)}
      onPointerDown={onPointerDown} onKeyDown={onKeyDown} />
  );
}

function GroupView({ group, ctx }: { group: Group; ctx: Ctx }) {
  const { layout, labels, onChange } = ctx;
  const dropping = ctx.drag?.target?.id === group.id ? ctx.drag.target.zone : null;
  const tabIds = group.tabs;
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' ? (i + 1) % tabIds.length : e.key === 'ArrowLeft' ? (i - 1 + tabIds.length) % tabIds.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabIds.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    const p = tabIds[to]!;
    onChange((l) => setActive(l, p));
    requestAnimationFrame(() => document.getElementById(`dock-tab-${p}`)?.focus());
  };

  const active = group.active;
  /** A change made from this group's menu: after it, focus follows the panel (this group may be gone). */
  const change: DockProps['onChange'] = (fn, msg) => {
    onChange(fn, msg);
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`dock-tab-${active}`)?.focus()));
  };
  const items: MenuItem[] = [{ kind: 'heading', id: 'h1', label: `Move ${labels[active]}` }];
  for (const [id, zone, text] of [['left', 'left', 'to the left edge'], ['right', 'right', 'to the right edge'], ['top', 'top', 'to the top'], ['bottom', 'bottom', 'to the bottom']] as const)
    items.push({ kind: 'item', id, label: `Dock ${text}`, onSelect: () => change((l) => dockToEdge(l, active, zone), `${labels[active]} moved ${text}`), disabled: tabIds.length === 1 && layout.root.kind === 'group' });
  const others = collectGroups(layout.root).filter((g) => g.id !== group.id);
  if (others.length) items.push({ kind: 'separator', id: 's1' });
  for (const g of others) items.push({ kind: 'item', id: `stack-${g.id}`, label: `Stack with ${g.tabs.map((p) => labels[p]).join(', ')}`, onSelect: () => change((l) => movePanel(l, active, g.id, 'center'), `${labels[active]} stacked with ${labels[g.tabs[0]!]}`) });
  if (tabIds.length > 1) {
    items.push({ kind: 'separator', id: 's2' });
    items.push({ kind: 'item', id: 'split-right', label: 'Open beside this pane', onSelect: () => change((l) => movePanel(l, active, group.id, 'right'), `${labels[active]} opened beside ${labels[tabIds.find((p) => p !== active)!]}`) });
    items.push({ kind: 'item', id: 'split-below', label: 'Open below this pane', onSelect: () => change((l) => movePanel(l, active, group.id, 'bottom'), `${labels[active]} opened below ${labels[tabIds.find((p) => p !== active)!]}`) });
  }
  if (active !== 'story') { items.push({ kind: 'separator', id: 's3' }); items.push({ kind: 'item', id: 'hide', label: `Hide ${labels[active]}`, onSelect: () => change((l) => hidePanel(l, active), `${labels[active]} hidden`) }); }

  return (
    <section className="dock-group" data-group={group.id} aria-label={`Panes: ${tabIds.map((p) => labels[p]).join(', ')}`} ref={(el) => { if (el) ctx.groupEls.set(group.id, el); else ctx.groupEls.delete(group.id); }}>
      <div className="dock-tabs">
        <div role="tablist" aria-label="Panels" className="dock-tablist">
          {tabIds.map((p, i) => (
            <button key={p} type="button" role="tab" id={`dock-tab-${p}`} aria-selected={p === active} aria-controls={`dock-panel-${group.id}`} tabIndex={p === active ? 0 : -1}
              className="dock-tab" data-testid={`tab-${p}`} data-panel={p}
              onPointerDown={(e) => ctx.startDrag(p, e)}
              onClick={() => { if (!ctx.suppressClick.current) onChange((l) => setActive(l, p)); }} onKeyDown={(e) => onTabKey(e, i)}>{labels[p]}</button>
          ))}
        </div>
        <Menu label={`Move or hide ${labels[active]}`} trigger="⋯" items={items} testId={`group-menu-${group.id}`} align="right" />
      </div>
      <div className="dock-body" role="tabpanel" id={`dock-panel-${group.id}`} aria-labelledby={`dock-tab-${active}`}>
        <Slot panel={active} />
      </div>
      {dropping && <div className="dock-drop" data-zone={dropping} aria-hidden="true" />}
    </section>
  );
}

const collectGroups = (n: Node): Group[] => (n.kind === 'group' ? [n] : n.children.flatMap(collectGroups));
/** The panels that are the active tab of some group: the ones that need to be mounted. */
export const activePanels = (l: Layout): PanelId[] => collectGroups(l.root).map((g) => g.active);
export { findGroup, panelsIn };
