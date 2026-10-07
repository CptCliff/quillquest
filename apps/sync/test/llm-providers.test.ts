import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AnthropicProvider, FakeProvider, LlmError, OpenAiCompatProvider, providerFromEnv } from '../src/llm';

const servers: Server[] = [];
afterEach(() => { while (servers.length) servers.pop()!.close(); });

/** A stub model server: records the request and answers with whatever the test says. */
async function stub(answer: (body: any, headers: Record<string, unknown>) => { status?: number; json: unknown }) {
  const seen: { path: string; body: any; headers: Record<string, unknown> }[] = [];
  const s = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      seen.push({ path: req.url!, body, headers: req.headers });
      const r = answer(body, req.headers);
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, seen };
}
const req = { system: 'SYS', user: 'USER', maxTokens: 123 };

describe('Anthropic provider', () => {
  it('sends the Messages API shape and joins the text blocks', async () => {
    const m = await stub(() => ({ json: { content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] } }));
    const out = await new AnthropicProvider({ apiKey: 'k-123', model: 'claude-test', baseUrl: m.url }).complete(req);
    expect(out.text).toBe('{"a":1}');
    expect(m.seen[0]!.path).toBe('/v1/messages');
    expect(m.seen[0]!.headers['x-api-key']).toBe('k-123');
    expect(m.seen[0]!.body).toEqual({ model: 'claude-test', max_tokens: 123, system: 'SYS', messages: [{ role: 'user', content: 'USER' }] });
  });
  it('turns an error status or an empty answer into an LlmError that does not echo the key', async () => {
    const bad = await stub(() => ({ status: 401, json: { error: 'bad key k-123' } }));
    const e = await new AnthropicProvider({ apiKey: 'k-123', model: 'm', baseUrl: bad.url }).complete(req).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect((e as LlmError).status).toBe(401);
    expect((e as Error).message).not.toContain('k-123');
    const empty = await stub(() => ({ json: { content: [] } }));
    await expect(new AnthropicProvider({ apiKey: 'k', model: 'm', baseUrl: empty.url }).complete(req)).rejects.toThrow(/no text/);
  });
  it('reports an unreachable model as an LlmError', async () => {
    await expect(new AnthropicProvider({ apiKey: 'k', model: 'm', baseUrl: 'http://127.0.0.1:1' }).complete(req)).rejects.toBeInstanceOf(LlmError);
  });
});

describe('OpenAI-compatible provider (Ollama, LM Studio, llama.cpp, vLLM, OpenRouter)', () => {
  it('sends chat completions with a system and a user message; the key is optional', async () => {
    const m = await stub(() => ({ json: { choices: [{ message: { content: '{"ok":true}' } }] } }));
    const p = new OpenAiCompatProvider({ baseUrl: `${m.url}/`, model: 'llama3' });
    expect((await p.complete(req)).text).toBe('{"ok":true}');
    expect(m.seen[0]!.path).toBe('/v1/chat/completions');
    expect(m.seen[0]!.headers.authorization).toBeUndefined();
    expect(m.seen[0]!.body).toEqual({ model: 'llama3', max_tokens: 123, messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }] });
    await new OpenAiCompatProvider({ baseUrl: m.url, model: 'x', apiKey: 'secret' }).complete(req);
    expect(m.seen[1]!.headers.authorization).toBe('Bearer secret');
  });
  it('refuses an error status or a reply with no content', async () => {
    const bad = await stub(() => ({ status: 500, json: {} }));
    await expect(new OpenAiCompatProvider({ baseUrl: bad.url, model: 'm' }).complete(req)).rejects.toThrow(/500/);
    const none = await stub(() => ({ json: { choices: [] } }));
    await expect(new OpenAiCompatProvider({ baseUrl: none.url, model: 'm' }).complete(req)).rejects.toThrow(/no text/);
  });
});

describe('the fake provider and the choice from the environment', () => {
  it('answers each kind with something parseable, records what it was sent, and can be told what to say', async () => {
    const f = new FakeProvider();
    expect(JSON.parse((await f.complete({ ...req, user: "Which one of this character's Skills does the sentence use?\nSkills: Sneak, Climb" })).text)).toEqual({ skill: 'Sneak' });
    f.queue('not json', new Error('boom'));
    expect((await f.complete(req)).text).toBe('not json');
    await expect(f.complete(req)).rejects.toThrow('boom');
    expect(f.calls).toHaveLength(3);
  });
  it('is not configured unless asked; the fake is refused in production; missing settings are named', () => {
    expect(providerFromEnv({}, false)).toBeNull();
    expect(providerFromEnv({ QUILLQUEST_LLM: 'none' }, true)).toBeNull();
    expect(providerFromEnv({ QUILLQUEST_LLM: 'fake' }, false)?.name).toBe('fake');
    expect(() => providerFromEnv({ QUILLQUEST_LLM: 'fake' }, true)).toThrow(/production/);
    expect(() => providerFromEnv({ QUILLQUEST_LLM: 'anthropic' }, false)).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => providerFromEnv({ QUILLQUEST_LLM: 'openai-compat' }, false)).toThrow(/QUILLQUEST_LLM_URL/);
    expect(providerFromEnv({ QUILLQUEST_LLM: 'openai-compat', QUILLQUEST_LLM_URL: 'http://localhost:11434', QUILLQUEST_LLM_MODEL: 'llama3' }, false)?.name).toBe('openai-compat');
    expect(() => providerFromEnv({ QUILLQUEST_LLM: 'mystery' }, false)).toThrow(/Unknown/);
  });
});
