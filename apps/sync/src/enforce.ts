import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';
import { fromYFragment, validateChange, type Actor, type ValidationResult } from '@quillquest/story';

/** The Yjs update inside a raw Hocuspocus sync message, or null for anything that cannot change the document. */
export function extractSyncUpdate(raw: Uint8Array): Uint8Array | null {
  const d = decoding.createDecoder(raw);
  decoding.readVarString(d); // document key
  const type = decoding.readVarUint(d);
  if (type !== 0 && type !== 4) return null; // Sync or SyncReply
  const syncType = decoding.readVarUint(d);
  if (syncType === 0) return null; // step 1 is only a state vector
  return decoding.readVarUint8Array(d);
}

export const FRAGMENT = 'default';

/** Root types the server writes. Clients may read them but never change them. */
const SERVER_OWNED_MAPS = ['ledger', 'characters', 'creation', 'canon', 'campaign', 'npcs', 'convictionLog'];

/**
 * A fingerprint of everything in the document except the story. Root types that arrive in an update are generic until
 * declared, so the known maps are declared first, and any other root type is itself a change.
 */
function serverOwned(doc: Y.Doc): string {
  const known = Object.fromEntries(SERVER_OWNED_MAPS.map((name) => [name, doc.getMap(name).toJSON()]));
  const unknown = [...doc.share.keys()].filter((k) => k !== FRAGMENT && !SERVER_OWNED_MAPS.includes(k)).sort();
  return JSON.stringify({ known, unknown });
}

/**
 * Applies `update` to a scratch copy of the document and runs the edit policy on the result. The real document is
 * never touched, so a rejected update leaves no trace. Cost is proportional to the story's size per inbound update;
 * see docs/m2-notes.md for measurements and the incremental plan.
 */
export function checkUpdate(doc: Y.Doc, update: Uint8Array, actor: Actor): ValidationResult {
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
    const before = fromYFragment(scratch.getXmlFragment(FRAGMENT));
    const ownedBefore = serverOwned(scratch);
    Y.applyUpdate(scratch, update);
    const after = fromYFragment(scratch.getXmlFragment(FRAGMENT));
    const result = validateChange(before, after, actor);
    if (serverOwned(scratch) !== ownedBefore)
      result.violations.push({ code: 'SERVER_OWNED', message: 'The ledger, characters and creation records are written by the game, not by clients' });
    return result;
  } catch (e) {
    return { violations: [{ code: 'SCHEMA', message: e instanceof Error ? e.message : 'unreadable document' }] };
  } finally {
    scratch.destroy();
  }
}
