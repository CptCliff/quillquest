'use client';
import { allowedPanels, hidePanel, presets, showPanel, type Layout, type PanelId, type Role } from '@quillquest/layout';
import { Menu, type MenuItem } from './Menu';

const PRESETS = [['classic', 'Classic: Story left, notes right'], ['reading', 'Reading: Story above, notes below'], ['focus', 'Writer\'s focus: Story only'], ['swap', 'Swap sides: notes left']] as const;

/** Presets, which panels are showing, and Reset. Every choice is announced. */
export function LayoutMenu({ layout, role, labels, onChange, onReset }: {
  layout: Layout; role: Role; labels: Record<PanelId, string>; onChange: (fn: (l: Layout) => Layout, announce?: string) => void; onReset: () => void;
}) {
  const items: MenuItem[] = [{ kind: 'heading', id: 'h-presets', label: 'Arrangements' }];
  for (const [key, text] of PRESETS) items.push({ kind: 'item', id: `preset-${key}`, label: text, onSelect: () => onChange(() => presets[key](role), `Layout: ${text.split(':')[0]}`) });
  items.push({ kind: 'separator', id: 's1' }, { kind: 'heading', id: 'h-panels', label: 'Panels' });
  for (const p of allowedPanels(role).filter((x) => x !== 'story' && x !== 'info')) {
    const shown = !layout.hidden.includes(p);
    items.push({ kind: 'item', id: `panel-${p}`, label: labels[p].replace(' •', ''), checked: shown, onSelect: () => onChange((l) => (shown ? hidePanel(l, p) : showPanel(l, p)), `${labels[p].replace(' •', '')} ${shown ? 'hidden' : 'shown'}`) });
  }
  items.push({ kind: 'separator', id: 's2' }, { kind: 'item', id: 'reset', label: 'Reset to the default layout', onSelect: onReset });
  return <Menu label="Layout" trigger={<>⊞<span className="menu-text"> Layout</span></>} items={items} testId="layout-menu" align="right" />;
}
