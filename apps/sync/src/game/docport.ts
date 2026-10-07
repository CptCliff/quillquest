import type { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { fromYFragment, type StoryDoc } from '@quillquest/story';
import type { DocPort, Projection } from './service';
import { draftName } from './docnames';

const FRAGMENT = 'default';
export const LEDGER = 'ledger';
export const CHARACTERS = 'characters';
export const CREATION = 'creation';
export const CANON = 'canon';
export const CAMPAIGN = 'campaign';
export const NPCS = 'npcs';
export const CONVICTION_LOG = 'convictionLog';
export const BATTLES = 'battles';

/** Reads and writes the live campaign document from the server. These writes bypass the client edit policy on purpose. */
export class HocuspocusDocPort implements DocPort {
  constructor(private hocuspocus: Hocuspocus) {}

  private async withDoc<T>(campaign: string, fn: (doc: Y.Doc) => T): Promise<T> {
    const conn = await this.hocuspocus.openDirectConnection(campaign, { system: true });
    try {
      let out!: T;
      await conn.transact((doc) => { out = fn(doc); });
      return out;
    } finally {
      await conn.disconnect();
    }
  }

  story(campaign: string): Promise<StoryDoc> {
    return this.withDoc(campaign, (doc) => fromYFragment(doc.getXmlFragment(FRAGMENT)));
  }

  setLocked(campaign: string, paragraphIds: string[], locked: boolean): Promise<void> {
    return this.withDoc(campaign, (doc) => {
      for (const node of doc.getXmlFragment(FRAGMENT).toArray()) {
        if (node instanceof Y.XmlElement && paragraphIds.includes(String(node.getAttribute('paragraphId')))) node.setAttribute('locked', locked as never);
      }
    });
  }

  appendParagraphs(campaign: string, items: { authorId: string; text: string }[]): Promise<string[]> {
    return this.withDoc(campaign, (doc) => {
      const ids: string[] = [];
      const els = items.map((it) => {
        const id = `p${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
        ids.push(id);
        const el = new Y.XmlElement('paragraph');
        el.setAttribute('paragraphId', id); el.setAttribute('authorId', it.authorId); el.setAttribute('pov', 'own');
        const text = new Y.XmlText();
        text.insert(0, it.text);
        el.insert(0, [text]);
        return el;
      });
      doc.getXmlFragment(FRAGMENT).push(els);
      return ids;
    });
  }

  draft(campaign: string, userId: string): Promise<StoryDoc> {
    return this.withDoc(draftName(campaign, userId), (doc) => fromYFragment(doc.getXmlFragment(FRAGMENT)));
  }

  /** Copies every paragraph of a player's private draft to the end of the shared story, as theirs, under the new ids in `map`. */
  async copyDraft(campaign: string, userId: string, map: Record<string, string>): Promise<void> {
    // A clone cannot be read until it is in a document, so the old id is taken from the original.
    const copies = await this.withDoc(draftName(campaign, userId), (doc) =>
      doc.getXmlFragment(FRAGMENT).toArray().flatMap((n) => (n instanceof Y.XmlElement ? [{ from: String(n.getAttribute('paragraphId')), el: n.clone() }] : [])));
    await this.withDoc(campaign, (doc) => {
      for (const { from, el } of copies) {
        el.setAttribute('paragraphId', map[from] ?? `p${Math.random().toString(36).slice(2, 10)}`);
        el.setAttribute('authorId', userId);
        el.setAttribute('pov', 'own');
        el.removeAttribute('locked');
      }
      doc.getXmlFragment(FRAGMENT).push(copies.map((c) => c.el));
    });
  }

  publish(campaign: string, projection: Projection): Promise<void> {
    return this.withDoc(campaign, (doc) => {
      const put = (name: string, entries: Record<string, unknown>) => {
        const map = doc.getMap(name);
        for (const [key, value] of Object.entries(entries)) {
          if (JSON.stringify(map.get(key)) !== JSON.stringify(value)) map.set(key, value);
        }
        // An entry the game no longer has (a discarded draft card) leaves the published map too.
        for (const key of [...map.keys()]) if (!(key in entries)) map.delete(key);
      };
      put(LEDGER, projection.ledger);
      put(CHARACTERS, projection.characters);
      put(CREATION, projection.creation);
      put(CANON, projection.canon);
      put(CAMPAIGN, projection.campaign);
      put(NPCS, projection.npcs);
      put(CONVICTION_LOG, projection.convictionLog);
      put(BATTLES, projection.battles);
    });
  }
}
