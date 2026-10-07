import { useEffect, useState } from 'react';
import type * as Y from 'yjs';

/** A live snapshot of a server-written Yjs map. Read-only here: clients cannot write these maps. */
export function useYMap<T>(map: Y.Map<unknown>): Record<string, T> {
  const [snapshot, setSnapshot] = useState<Record<string, T>>(() => map.toJSON() as Record<string, T>);
  useEffect(() => {
    const update = () => setSnapshot(map.toJSON() as Record<string, T>);
    map.observeDeep(update);
    update();
    return () => map.unobserveDeep(update);
  }, [map]);
  return snapshot;
}
