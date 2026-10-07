'use client';
import { useEffect, useState } from 'react';

type Choice = 'system' | 'light' | 'dark';
const NEXT: Record<Choice, Choice> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Choice, string> = { system: 'Theme: follow my device', light: 'Theme: light', dark: 'Theme: dark' };
const ICON: Record<Choice, string> = { system: '◐', light: '☀', dark: '☾' };

/** Light, dark, or follow the device. The choice is remembered in this browser and applied before first paint (see layout.tsx). */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>('system');
  useEffect(() => { try { const t = localStorage.getItem('qq.theme'); if (t === 'light' || t === 'dark') setChoice(t); } catch { /* private window */ } }, []);
  const apply = (c: Choice) => {
    setChoice(c);
    try { if (c === 'system') { localStorage.removeItem('qq.theme'); delete document.documentElement.dataset.theme; } else { localStorage.setItem('qq.theme', c); document.documentElement.dataset.theme = c; } } catch { /* the choice just will not be remembered */ }
  };
  return <button type="button" className="quiet theme-toggle" data-testid="theme-toggle" aria-label={`${LABEL[choice]}. Activate to change.`} title={LABEL[choice]} onClick={() => apply(NEXT[choice])}>{ICON[choice]}</button>;
}
