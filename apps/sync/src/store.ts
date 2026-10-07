import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Where documents live. M4 adds a Postgres implementation behind the same interface. */
export interface DocumentStore {
  load(name: string): Promise<Uint8Array | null>;
  save(name: string, state: Uint8Array): Promise<void>;
}

const safe = (name: string) => {
  if (!/^[A-Za-z0-9_-]{1,64}(~draft~[A-Za-z0-9_-]{1,64}|~gm)?$/.test(name)) throw new Error(`bad document name: ${name}`);
  return name;
};

export class FileStore implements DocumentStore {
  constructor(private dir: string) {}

  async load(name: string) {
    try {
      return new Uint8Array(await readFile(join(this.dir, `${safe(name)}.ydoc`)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async save(name: string, state: Uint8Array) {
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, `${safe(name)}.ydoc`);
    await writeFile(`${file}.tmp`, state);
    await rename(`${file}.tmp`, file); // never leave a half-written document
  }
}

export class MemoryStore implements DocumentStore {
  docs = new Map<string, Uint8Array>();
  async load(name: string) { return this.docs.get(name) ?? null; }
  async save(name: string, state: Uint8Array) { this.docs.set(name, state); }
}
