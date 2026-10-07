import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultLayout, hidePanel, sanitize, type Layout, type Role } from '@quillquest/layout';
import type { GameApi } from '../../lib/game-api';

const SPLIT_KEY = 'qq.split';
/** The person's old single divider width, from before panes could be rearranged. */
function legacySplit(): number | null {
  try { const v = Number(localStorage.getItem(SPLIT_KEY)); return v >= 25 && v <= 80 ? v : null; } catch { return null; }
}

/**
 * Loads this person's saved layout (per campaign and form factor), applies changes at once, and saves them a moment after the last one.
 * Any failure to load or save leaves them with a working default: the workspace never depends on the server answering.
 * The info card is transient (it appears and goes with what you open), so it is never saved.
 */
export function useLayout(game: GameApi, role: Role, device: 'wide' | 'phone') {
  const [layout, setLayoutState] = useState<Layout>(() => defaultLayout(role));
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(layout);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  latest.current = layout;

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!dirty.current) return;
    dirty.current = false;
    game.saveLayout(device, hidePanel(latest.current, 'info')).catch(() => undefined);
  }, [game, device]);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    game.layout(device).then((r) => {
      if (!live) return;
      let l = sanitize(r.layout, role);
      const old = legacySplit();
      if (!r.saved && old && l.root.kind === 'split' && l.root.dir === 'row' && l.root.sizes.length === 2) l = { ...l, root: { ...l.root, sizes: [old, 100 - old] } };
      setLayoutState(l); setLoaded(true);
    }, () => { if (live) { setLayoutState(defaultLayout(role)); setLoaded(true); } });
    return () => { live = false; flush(); };
  }, [game, role, device, flush]);

  /** `save: false` for changes that are not the person's arrangement (the info card appearing). */
  const update = useCallback((fn: (l: Layout) => Layout, opts: { save?: boolean } = {}) => {
    setLayoutState((l) => fn(l));
    if (opts.save === false) return;
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  }, [flush]);

  const reset = useCallback(async () => {
    dirty.current = false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    try { const r = await game.resetLayout(device); setLayoutState(sanitize(r.layout, role)); } catch { setLayoutState(defaultLayout(role)); }
  }, [game, device, role]);

  return { layout, update, reset, loaded };
}
