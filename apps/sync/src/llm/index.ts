import { AnthropicProvider } from './anthropic';
import { FakeProvider } from './fake';
import { OpenAiCompatProvider } from './openai-compat';
import type { LlmProvider } from './types';

export * from './types';
export { AnthropicProvider, FakeProvider, OpenAiCompatProvider };

/** Chooses the provider from the operator's environment. Unset means "not configured": the assistant answers 501 and nothing else changes. */
export function providerFromEnv(env: Record<string, string | undefined>, production: boolean): LlmProvider | null {
  const which = env.QUILLQUEST_LLM;
  if (!which || which === 'none') return null;
  if (which === 'fake') {
    if (production) throw new Error('QUILLQUEST_LLM=fake must not be used in production');
    return new FakeProvider();
  }
  const need = (k: string) => env[k] || (() => { throw new Error(`${k} is required for QUILLQUEST_LLM=${which}`); })();
  if (which === 'anthropic') return new AnthropicProvider({ apiKey: need('ANTHROPIC_API_KEY'), model: need('QUILLQUEST_LLM_MODEL'), baseUrl: env.QUILLQUEST_LLM_URL });
  if (which === 'openai-compat') return new OpenAiCompatProvider({ baseUrl: need('QUILLQUEST_LLM_URL'), model: need('QUILLQUEST_LLM_MODEL'), apiKey: env.QUILLQUEST_LLM_KEY });
  throw new Error(`Unknown QUILLQUEST_LLM: ${which} (anthropic, openai-compat, fake, none)`);
}
