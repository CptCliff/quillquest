# Choosing the model behind the Claude assistant

The assistant talks to a model through one small interface (`apps/sync/src/llm/types.ts`): `complete({system, user, maxTokens}) -> {text}`.
Everything the model says is untrusted text. `packages/prompts` parses it strictly (valid JSON, bounded lengths, a Skill that is on the sheet,
a real Danger rank); anything else is retried once and then refused. Nothing a model writes reaches the story, the Canon or a sheet unless a person accepts it.

## Configure (server environment only; never from a client)
| `QUILLQUEST_LLM` | Also needed | Notes |
|---|---|---|
| unset / `none` | | The assistant answers 501 "not set up". The rest of the game is unchanged. |
| `anthropic` | `ANTHROPIC_API_KEY`, `QUILLQUEST_LLM_MODEL` (`QUILLQUEST_LLM_URL` optional) | Claude through the Messages API, by plain `fetch`. |
| `openai-compat` | `QUILLQUEST_LLM_URL`, `QUILLQUEST_LLM_MODEL` (`QUILLQUEST_LLM_KEY` optional) | Anything that speaks `/v1/chat/completions`: Ollama (`http://localhost:11434`), LM Studio, llama.cpp server, vLLM, OpenRouter, OpenAI. |
| `fake` | | Deterministic answers for tests and browser runs. Refused when `NODE_ENV=production`. |

To add a provider, write one class with a `name` and a `complete` method and add a case to `providerFromEnv` (`apps/sync/src/llm/index.ts`).

## Pros and cons of a swappable interface
Pros: local models and any vendor work; no lock-in to one price list or outage; the GM's notes and scenes can stay on the table's own machine;
tests need no key or network; adding a provider is one small file.
Cons: weaker local models are worse at strict JSON and at the Danger test, so suggestions will be rougher (the parsers and "draft only" contain this, they do not fix it);
prompts must suit the weakest model in use; local models can be slow, which makes the paraphrase Skill chip feel laggy; each provider has its own request shape and failure modes
(only the shapes are tested here, against a stub server, not live models); a server pointed at an internal URL must trust whoever sets the environment.

## Limits
A per-session cap (default 30, set by the GM, 0 turns it off) counts every call, including failed ones, and a repeated Skill-match sentence is answered from memory.
Every answer is logged as a Suggestion (kind, input, output, status, provider, session). Every prompt carries the campaign's "handle lightly or leave out" themes.
