import { LlmError, type LlmProvider, type LlmRequest } from './types';

/** Claude through the Messages API, by plain `fetch`: no SDK to install or keep current. */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  constructor(private o: { apiKey: string; model: string; baseUrl?: string; timeoutMs?: number }) {}

  async complete(req: LlmRequest, signal?: AbortSignal): Promise<{ text: string }> {
    const res = await fetch(`${this.o.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.o.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.o.model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: 'user', content: req.user }] }),
      signal: signal ?? AbortSignal.timeout(this.o.timeoutMs ?? 30_000),
    }).catch((e: unknown) => { throw new LlmError(`Could not reach the model: ${e instanceof Error ? e.message : 'network error'}`); });
    if (!res.ok) throw new LlmError(`The model refused the request (${res.status})`, res.status);
    const body = (await res.json().catch(() => null)) as { content?: { type: string; text?: string }[] } | null;
    const text = body?.content?.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('') ?? '';
    if (!text) throw new LlmError('The model returned no text');
    return { text };
  }
}
