/**
 * The one thing the server needs from a language model. Providers are swappable: pick one at start with QUILLQUEST_LLM
 * (see docs/llm-providers.md). The answer is untrusted text; `@quillquest/prompts` decides what of it is believed.
 */
export interface LlmRequest { system: string; user: string; maxTokens: number }
export interface LlmProvider {
  /** Short name logged with every suggestion ("anthropic", "openai-compat", "fake"). */
  readonly name: string;
  complete(req: LlmRequest, signal?: AbortSignal): Promise<{ text: string }>;
}

export class LlmError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'LlmError';
  }
}
