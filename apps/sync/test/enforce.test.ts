import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { checkUpdate, extractSyncUpdate } from '../src/enforce';
import { addParagraph, attrs } from './helpers';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

function story(paragraphs: number, wordsEach: number) {
  const doc = new Y.Doc();
  const f = doc.getXmlFragment('default');
  for (let i = 0; i < paragraphs; i++) addParagraph(f, attrs(`p${i}`, i % 2 ? 'ilse' : 'sella', i < paragraphs / 2 ? { locked: true } : {}), words(wordsEach));
  return doc;
}

/** The update a client would send for a one-character edit. */
function editUpdate(doc: Y.Doc, paragraph: number) {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  let captured!: Uint8Array;
  copy.on('update', (u: Uint8Array) => (captured = u));
  ((copy.getXmlFragment('default').get(paragraph) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'x');
  return captured;
}

describe('checkUpdate', () => {
  it('allows an author edit and rejects the same edit by someone else', () => {
    const doc = story(4, 5);
    const u = editUpdate(doc, 3); // p3: ilse, unlocked
    expect(checkUpdate(doc, u, { id: 'ilse', role: 'player' }).violations).toEqual([]);
    expect(checkUpdate(doc, u, { id: 'sella', role: 'player' }).violations.map((v) => v.code)).toEqual(['NOT_OWNER_EDIT']);
  });
  it('never touches the real document', () => {
    const doc = story(4, 5);
    const before = Y.encodeStateAsUpdate(doc);
    checkUpdate(doc, editUpdate(doc, 3), { id: 'sella', role: 'player' });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
  it('reads a document that is not a story as a schema violation, not a crash', () => {
    const doc = new Y.Doc();
    doc.getXmlFragment('default').push([new Y.XmlElement('heading')]);
    const other = new Y.Doc();
    other.getXmlFragment('default').push([new Y.XmlElement('heading')]);
    expect(checkUpdate(doc, Y.encodeStateAsUpdate(other), { id: 'a', role: 'player' }).violations[0]?.code).toBe('SCHEMA');
  });
  it('ignores messages that cannot change the document', () => {
    expect(extractSyncUpdate(new Uint8Array([1, 120, 1, 0]))).toBeNull(); // awareness
  });
});

describe('cost per inbound update', () => {
  it('stays well under a keystroke interval for a 20,000-word story', () => {
    const doc = story(200, 100); // 20,000 words, half of it locked
    const u = editUpdate(doc, 199);
    const runs = 5;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) checkUpdate(doc, u, { id: 'ilse', role: 'player' });
    const ms = (performance.now() - t0) / runs;
    console.log(`checkUpdate on 20,000 words: ${ms.toFixed(1)} ms per update`);
    expect(ms).toBeLessThan(250);
  });
});
