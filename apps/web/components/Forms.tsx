'use client';
import { useState } from 'react';
import { ApiFailure } from '../lib/game-api';

export interface FieldSpec {
  key: string;
  label: string;
  kind?: 'text' | 'select' | 'check';
  options?: { value: string; label: string }[];
  placeholder?: string;
  initial?: string | boolean;
}

/**
 * A small form: a few labelled fields and one button. Text fields and checkboxes clear after a successful save, so a form can be used again
 * (a second chapter, another proposal). Test ids are `${testId}-${key}` for fields and `${testId}-go` for the button.
 */
export function StepForm({ testId, title, hint, fields, submit, label = 'Save', disabled, run, busy, secondary }: {
  testId: string; title?: string; hint?: string; fields: FieldSpec[]; label?: string; disabled?: boolean; busy?: boolean;
  /** A second button that reads the current values without saving them (for example, asking Claude to check a draft). */
  secondary?: { label: string; testId: string; onClick: (values: Record<string, string | boolean>) => Promise<unknown> };
  submit: (values: Record<string, string | boolean>) => Promise<unknown>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const start = () => Object.fromEntries(fields.map((f) => [f.key, f.initial ?? (f.kind === 'check' ? false : f.kind === 'select' ? (f.options?.[0]?.value ?? '') : '')]));
  const [v, setV] = useState<Record<string, string | boolean>>(start);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const val = (f: FieldSpec) => (f.key in v ? v[f.key]! : (f.initial ?? (f.kind === 'check' ? false : f.kind === 'select' ? (f.options?.[0]?.value ?? '') : '')));
  return (
    <form className="stepform" data-testid={testId} onSubmit={(e) => {
      e.preventDefault();
      const values = Object.fromEntries(fields.map((f) => [f.key, val(f)]));
      setResult(null);
      run(async () => {
        try { await submit(values); } catch (err) { setResult({ ok: false, text: err instanceof ApiFailure ? err.message : 'That did not save. Try again.' }); throw err; }
        setResult({ ok: true, text: 'Saved.' });
        // Forms that save a sheet field (Beliefs, Instincts) come back showing what was saved, via `initial`; a form that adds a thing (a chapter, a proposal) clears.
        setV((cur) => Object.fromEntries(Object.entries(cur).map(([k, x]) => { const f = fields.find((y) => y.key === k); return [k, f?.kind === 'select' ? x : f?.initial !== undefined ? f.initial : typeof x === 'boolean' ? false : '']; })));
      });
    }}>
      {title && <h4>{title}</h4>}
      {hint && <p className="muted">{hint}</p>}
      {fields.map((f) => (
        f.kind === 'check' ? (
          <label key={f.key} className="check"><input type="checkbox" data-testid={`${testId}-${f.key}`} checked={val(f) === true} onChange={(e) => setV({ ...v, [f.key]: e.target.checked })} /> {f.label}</label>
        ) : (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            {f.kind === 'select' ? (
              <select data-testid={`${testId}-${f.key}`} value={String(val(f))} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}>
                {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input data-testid={`${testId}-${f.key}`} value={String(val(f))} placeholder={f.placeholder} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
            )}
          </label>
        )
      ))}
      <button type="submit" data-testid={`${testId}-go`} disabled={disabled || busy}>{label}</button>
      {result && <span role={result.ok ? 'status' : 'alert'} className={result.ok ? 'form-ok' : 'form-error'} data-testid={`${testId}-result`}>{result.text}</span>}
      {secondary && <button type="button" data-testid={`${testId}-${secondary.testId}`} disabled={disabled || busy} onClick={() => run(() => secondary.onClick(Object.fromEntries(fields.map((f) => [f.key, val(f)]))))}>{secondary.label}</button>}
    </form>
  );
}
