'use client';
import { useState } from 'react';

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
export function StepForm({ testId, title, fields, submit, label = 'Save', disabled, run, busy }: {
  testId: string; title?: string; fields: FieldSpec[]; label?: string; disabled?: boolean; busy?: boolean;
  submit: (values: Record<string, string | boolean>) => Promise<unknown>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const start = () => Object.fromEntries(fields.map((f) => [f.key, f.initial ?? (f.kind === 'check' ? false : f.kind === 'select' ? (f.options?.[0]?.value ?? '') : '')]));
  const [v, setV] = useState<Record<string, string | boolean>>(start);
  const val = (f: FieldSpec) => (f.key in v ? v[f.key]! : (f.initial ?? (f.kind === 'check' ? false : f.kind === 'select' ? (f.options?.[0]?.value ?? '') : '')));
  return (
    <form className="stepform" data-testid={testId} onSubmit={(e) => {
      e.preventDefault();
      const values = Object.fromEntries(fields.map((f) => [f.key, val(f)]));
      run(async () => { await submit(values); setV((cur) => Object.fromEntries(Object.entries(cur).map(([k, x]) => [k, fields.find((f) => f.key === k)?.kind === 'select' ? x : typeof x === 'boolean' ? false : '']))); });
    }}>
      {title && <h4>{title}</h4>}
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
    </form>
  );
}
