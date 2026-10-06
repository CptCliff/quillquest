import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { fromPmJson, fromYFragment, validateChange } from '../src';

function yDoc(build: (f: Y.XmlFragment) => void): Y.XmlFragment {
  const doc = new Y.Doc();
  const f = doc.getXmlFragment('default');
  build(f);
  return f;
}
function yPara(f: Y.XmlFragment, attrs: Record<string, unknown>, runs: [string, Record<string, unknown>?][]) {
  const el = new Y.XmlElement('paragraph');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v as string);
  const text = new Y.XmlText();
  el.insert(0, [text]);
  f.push([el]);
  let at = 0;
  for (const [t, a] of runs) { text.insert(at, t, a); at += t.length; }
}

describe('adapters agree', () => {
  it('read the same story from ProseMirror JSON and from Yjs', () => {
    const f = yDoc((frag) => {
      yPara(frag, { paragraphId: 'p1', authorId: 'ilse', pov: 'own', locked: true }, [['I climb', {}], [' fast', { bold: {} }]]);
      yPara(frag, { paragraphId: 'p2', authorId: 'sella', pov: 'gm' }, [
        ['Base ', {}],
        ['added', { insertion: { id: 'rook.1' } }],
        [' gone', { deletion: { id: 'rook.2' } }],
      ]);
    });
    const json = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { paragraphId: 'p1', authorId: 'ilse', pov: 'own', locked: true }, content: [
          { type: 'text', text: 'I climb' }, { type: 'text', text: ' fast', marks: [{ type: 'bold' }] }] },
        { type: 'paragraph', attrs: { paragraphId: 'p2', authorId: 'sella', pov: 'gm', locked: false }, content: [
          { type: 'text', text: 'Base ' },
          { type: 'text', text: 'added', marks: [{ type: 'insertion', attrs: { id: 'rook.1' } }] },
          { type: 'text', text: ' gone', marks: [{ type: 'deletion', attrs: { id: 'rook.2' } }] }] },
      ],
    };
    expect(fromYFragment(f)).toEqual(fromPmJson(json));
  });
  it('strips the hash y-prosemirror adds to repeatable mark keys', () => {
    const f = yDoc((frag) => yPara(frag, { paragraphId: 'p1', authorId: 'a' }, [['x', { 'insertion--abc123': { id: 'a.7' } }]]));
    expect(fromYFragment(f)[0]!.cells[0]!.ins).toEqual({ id: 'a.7', authorId: 'a' });
  });
  it('rejects anything that is not a paragraph', () => {
    expect(() => fromPmJson({ type: 'doc', content: [{ type: 'heading' }] })).toThrow(/paragraphs only/);
    expect(() => fromYFragment(yDoc((f) => f.push([new Y.XmlElement('heading')])))).toThrow(/paragraphs only/);
  });
  it('end to end: a real Yjs edit by another writer is caught as a violation', () => {
    const doc = new Y.Doc();
    const f = doc.getXmlFragment('default');
    yPara(f, { paragraphId: 'p1', authorId: 'ilse', pov: 'own', locked: false }, [['I climb.', {}]]);
    const before = fromYFragment(f);
    (f.get(0) as Y.XmlElement).toArray().forEach((t) => (t as Y.XmlText).insert(0, 'X'));
    const r = validateChange(before, fromYFragment(f), { id: 'sella', role: 'player' });
    expect(r.violations.map((v) => v.code)).toEqual(['NOT_OWNER_EDIT']);
  });
});
