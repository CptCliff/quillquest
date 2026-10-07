import { LlmError, type LlmProvider, type LlmRequest } from './types';

/**
 * Anything that speaks `/v1/chat/completions`: Ollama, LM Studio, llama.cpp's server, vLLM, OpenRouter, OpenAI. The URL comes from the
 * operator's environment, never from a client, so a table member cannot point the server at an address of their choosing.
 */
export class OpenAiCompatProvider implements LlmProvider {
  readonly name = 'openai-compat';
  constructor(private o: { baseUrl: string; model: string; apiKey?: string; timeoutMs?: number }) {}

  async complete(req: LlmRequest, signal?: AbortSignal): Promise<{ text: string }> {
    const res = await fetch(`${this.o.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.o.model, max_tokens: req.maxTokens, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }] }),
      signal: signal ?? AbortSignal.timeout(this.o.timeoutMs ?? 120_000), // a local model on a laptop can be slow
    }).catch((e: unknown) => { throw new LlmError(`Could not reach the model: ${e instanceof Error ? e.message : 'network error'}`); });
    if (!res.ok) throw new LlmError(`The model refused the request (${res.status})`, res.status);
    const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
    const text = body?.choices?.[0]?.message?.content ?? '';
    if (!text) throw new LlmError('The model returned no text');
    return { text };
  }
}
