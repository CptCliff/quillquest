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
    Y.applyUpdate(scratch, update);
    const after = fromYFragment(scratch.getXmlFragment(FRAGMENT));
    return validateChange(before, after, actor);
  } catch (e) {
    return { violations: [{ code: 'SCHEMA', message: e instanceof Error ? e.message : 'unreadable document' }], gmActions: [] };
  } finally {
    scratch.destroy();
  }
}
