import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { signDevToken, type Identity } from '../src/auth';
import { createSyncServer, type SyncServerOptions } from '../src/server';
import { MemoryStore } from '../src/store';
import type { LlmProvider } from '../src/llm';

export const SECRET = 'test-secret';
export const ILSE: Identity = { id: 'ilse', name: 'Ilse', role: 'player', color: '#c2410c' };
export const SELLA: Identity = { id: 'sella', name: 'Sella', role: 'player', color: '#1d4ed8' };
export const GM: Identity = { id: 'gm1', name: 'GM', role: 'gm', color: '#15803d' };

export async function startServer(store = new MemoryStore(), game: { devDice?: boolean } = { devDice: true }, llm: LlmProvider | null = null, mail?: SyncServerOptions['mail']) {
  const server = createSyncServer({ store, secret: SECRET, port: 0, debounceMs: 20, game, llm, mail });
  await server.listen();
  return { server, store, url: server.webSocketURL, http: `http://127.0.0.1:${server.address.port}` };
}

/** Calls the game API as a signed-in user. Returns the status and parsed body. */
export async function api(base: string, who: Identity | null, method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(who || token ? { Authorization: `Bearer ${token ?? signDevToken(who!, SECRET)}` } : {}),
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

export interface Client {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  fragment: Y.XmlFragment;
  closes: { code: number; reason: string }[];
  destroy(): void;
}

export async function connect(url: string, who: Identity, name = 'campaign-1', token = signDevToken(who, SECRET)): Promise<Client> {
  const doc = new Y.Doc();
  const closes: Client['closes'] = [];
  let synced: () => void;
  let failed: (e: Error) => void;
  const ready = new Promise<void>((r, rej) => ((synced = r), (failed = rej)));
  const provider = new HocuspocusProvider({
    url, name, document: doc, token,
    onSynced: () => synced(),
    onAuthenticationFailed: ({ reason }) => failed(new Error(`auth failed: ${reason}`)),
    onClose: ({ event }) => closes.push({ code: event.code, reason: event.reason }),
  });
  await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error('sync timeout')), 5000))]);
  return { doc, provider, fragment: doc.getXmlFragment('default'), closes, destroy: () => provider.destroy() };
}

export async function waitFor(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

export function addParagraph(f: Y.XmlFragment, attrs: Record<string, string | boolean>, text: string, at = f.length): Y.XmlElement {
  const el = new Y.XmlElement('paragraph');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v as string);
  const t = new Y.XmlText();
  el.insert(0, [t]);
  if (text) t.insert(0, text);
  f.insert(at, [el]);
  return el;
}
/** Plain text of a paragraph: XmlText.toString() renders marks as tags, so read the delta instead. */
export const plain = (t: Y.XmlText) => (t.toDelta() as { insert: unknown }[]).map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');
export const textOf = (el: Y.XmlElement) => plain(el.get(0) as Y.XmlText);
export const para = (f: Y.XmlFragment, i: number) => f.get(i) as Y.XmlElement;
export const attrs = (id: string, author: string, extra: Record<string, string | boolean> = {}) => ({ paragraphId: id, authorId: author, pov: 'own', locked: false, ...extra });
