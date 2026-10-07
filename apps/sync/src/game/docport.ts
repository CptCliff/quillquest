import type { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { fromYFragment, type StoryDoc } from '@quillquest/story';
import type { Character } from '@quillquest/rules';
import type { DocPort, LedgerEntry } from './service';

const FRAGMENT = 'default';
export const LEDGER = 'ledger';
export const CHARACTERS = 'characters';

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

  publish(campaign: string, projection: { ledger: Record<string, LedgerEntry>; characters: Record<string, Character> }): Promise<void> {
    return this.withDoc(campaign, (doc) => {
      const put = (name: string, entries: Record<string, unknown>) => {
        const map = doc.getMap(name);
        for (const [key, value] of Object.entries(entries)) {
          if (JSON.stringify(map.get(key)) !== JSON.stringify(value)) map.set(key, value);
        }
      };
      put(LEDGER, projection.ledger);
      put(CHARACTERS, projection.characters);
    });
  }
}
