'use client';
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PanelId } from '@quillquest/layout';

/**
 * Panels never remount when the layout changes. Each panel is rendered once, by a portal, into its own container element; a `Slot` in
 * the dock simply moves that container into place. Moving a DOM node keeps the editor, its scroll position and its state intact.
 */
interface Registry { container(panel: PanelId): HTMLElement; holder(): HTMLElement }
const Ctx = createContext<Registry | null>(null);

export function PanelHost({ panels, mounted, children }: { panels: Partial<Record<PanelId, ReactNode>>; mounted: PanelId[]; children: ReactNode }) {
  const containers = useRef(new Map<PanelId, HTMLElement>());
  const holderRef = useRef<HTMLDivElement | null>(null);
  const registry = useRef<Registry>({
    container(panel) {
      let el = containers.current.get(panel);
      if (!el) { el = document.createElement('div'); el.className = 'panel-body'; el.dataset.panel = panel; containers.current.set(panel, el); }
      return el;
    },
    holder: () => holderRef.current!,
  });
  return (
    <Ctx.Provider value={registry.current}>
      {children}
      {/* Parking place for a panel between slots; never visible. */}
      <div ref={holderRef} hidden aria-hidden="true" />
      {mounted.map((p) => (typeof document === 'undefined' ? null : createPortal(panels[p] ?? null, registry.current.container(p), p)))}
    </Ctx.Provider>
  );
}

/** Where a panel is shown. Moves the panel's container here, and parks it again when this slot goes away. */
export function Slot({ panel }: { panel: PanelId }) {
  const reg = useContext(Ctx)!;
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const slot = ref.current!;
    const el = reg.container(panel);
    slot.appendChild(el);
    return () => { if (el.parentElement === slot) reg.holder().appendChild(el); };
  }, [panel, reg]);
  return <div ref={ref} className="dock-slot" data-slot={panel} />;
}
