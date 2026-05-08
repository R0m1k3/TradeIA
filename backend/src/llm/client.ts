import axios, { AxiosError } from 'axios';
import { getCredential } from '../config/credentials';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  tokensUsed: number;
  durationMs: number;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripMarkdownJson(raw: string): string {
  return raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
}

// ── Concurrency limiter for Ollama (cloud models have rate limits) ──
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.LLM_MAX_CONCURRENT || '1', 10));
let activeCalls = 0;
const callQueue: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (activeCalls < MAX_CONCURRENT) {
    activeCalls++;
    return;
  }
  return new Promise<void>((resolve) => {
    callQueue.push(() => {
      activeCalls++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeCalls--;
  if (callQueue.length > 0) {
    const next = callQueue.shift()!;
    next();
  }
}

function supportsThinking(model: string): boolean {
  return (
    model.includes('claude-opus') ||
    model.includes('claude-sonnet-4') ||
    model.includes('o1') ||
    model.includes('o3') ||
    model.includes('deepseek-r1') ||
    model.includes('gemini-2.0-flash-thinking')
  );
}

function extractOpenRouterContent(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    // Extended thinking response: array of { type: "thinking"|"text", ... }
    return (raw as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === 'text')
      .map((b) => b.text || '')
      .join('');
  }
  return '';
}

async function callOpenRouter(model: string, messages: LLMMessage[], thinking?: boolean): Promise<LLMResponse> {
  const start = Date.now();
  const apiKey = await getCredential('openrouter_api_key', 'OPENROUTER_API_KEY');

  const useThinking = thinking && supportsThinking(model);
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: useThinking ? 1 : 0.1,
    max_tokens: useThinking ? 20000 : 4096,
  };
  if (useThinking && (model.includes('claude-opus') || model.includes('claude-sonnet-4'))) {
    body.thinking = { type: 'enabled', budget_tokens: 12000 };
  }

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    body,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nexus-trade.local',
        'X-Title': 'Nexus Trade AI',
      },
      timeout: useThinking ? 120_000 : 30_000,
    }
  );

  const rawContent = response.data.choices?.[0]?.message?.content;
  const content = extractOpenRouterContent(rawContent);
  const tokensUsed = response.data.usage?.total_tokens || 0;
  return { content: stripMarkdownJson(content), tokensUsed, durationMs: Date.now() - start };
}

async function callOllama(model: string, messages: LLMMessage[]): Promise<LLMResponse> {
  const start = Date.now();
  const baseUrl = (await getCredential('ollama_base_url', 'OLLAMA_BASE_URL') || 'http://ollama:11434').replace(/\/+$/, '');
  const apiKey = await getCredential('ollama_api_key', 'OLLAMA_API_KEY');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    console.log(`[Ollama] Sending auth header for model: ${model}`);
  } else {
    console.warn(`[Ollama] No API key — calling ${model} without auth`);
  }

  const response = await axios.post(
    `${baseUrl}/api/chat`,
    {
      model,
      messages,
      stream: false,
      options: { temperature: 0.1 },
    },
    { headers, timeout: 900_000 }
  );

  const content = response.data.message?.content || '';
  const tokensUsed =
    (response.data.prompt_eval_count || 0) + (response.data.eval_count || 0);
  return { content: stripMarkdownJson(content), tokensUsed, durationMs: Date.now() - start };
}

export async function callLLM(
  agentName: string,
  model: string,
  systemPrompt: string,
  userContent: string,
  options?: { thinking?: boolean }
): Promise<LLMResponse> {
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  const provider = await getCredential('llm_provider', 'LLM_PROVIDER') || 'openrouter';
  const maxAttempts = provider === 'ollama' ? 2 : 3;
  const delays = provider === 'ollama'
    ? [2000, 4000]
    : [1000, 2000, 4000];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (provider === 'ollama') {
      await acquireSlot();
    }

    try {
      const result =
        provider === 'ollama'
          ? await callOllama(model, messages)
          : await callOpenRouter(model, messages, options?.thinking);

      console.log(
        JSON.stringify({
          event: 'llm_call',
          agent: agentName,
          model,
          duration_ms: result.durationMs,
          tokens_used: result.tokensUsed,
          provider,
        })
      );

      return result;
    } catch (err) {
      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status;
      const body = axiosErr.response?.data;
      console.error(
        `[LLM] ${agentName} attempt ${attempt + 1}/${maxAttempts} failed — status ${status}: ${axiosErr.message}`,
        body ? JSON.stringify(body) : ''
      );

      // Model fallback: if auth/rate-limit/gateway overload, try a smaller cloud model.
      if (attempt === maxAttempts - 2 && (status === 401 || status === 403 || status === 429 || status === 502 || status === 503)) {
        const fallbackModel = downgradeModel(model);
        if (fallbackModel !== model) {
          console.warn(`[LLM] Retrying ${agentName} with fallback model: ${fallbackModel}`);
          try {
            const result = provider === 'ollama'
              ? await callOllama(fallbackModel, messages)
              : await callOpenRouter(fallbackModel, messages, false); // no thinking on fallback
            console.log(`[LLM] ${agentName} succeeded with fallback model ${fallbackModel}`);
            return result;
          } catch (fallbackErr) {
            throw new Error(`LLM call failed for agent ${agentName} (tried ${model} + ${fallbackModel}): ${(fallbackErr as Error).message}`);
          }
        }
      }

      if (attempt < maxAttempts - 1) {
        await sleep(delays[attempt] || 4000);
      } else {
        throw new Error(`LLM call failed after ${maxAttempts} retries for agent ${agentName}: ${axiosErr.message}`);
      }
    } finally {
      if (provider === 'ollama') {
        releaseSlot();
      }
    }
  }

  throw new Error('Unreachable');
}

function downgradeModel(model: string): string {
  // Ollama cloud models: downgrade pro → flash
  if (model.includes('pro')) return model.replace('pro', 'flash');
  if (model.includes('glm-5.1')) return 'deepseek-v4-flash:cloud';
  if (model.includes('kimi')) return 'deepseek-v4-flash:cloud';
  if (model.includes('gemma4')) return 'deepseek-v4-flash:cloud';
  if (model.includes('qwen3.6')) return 'deepseek-v4-flash:cloud';
  // OpenRouter: downgrade as before
  if (model.includes('opus')) return model.replace(/opus[^/]*/, 'sonnet-4-6');
  if (model.includes('sonnet')) return model.replace(/sonnet[^/]*/, 'haiku-4-5');
  return model;
}

export function parseJsonResponse<T>(content: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    const match = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
    throw new Error(`Failed to parse JSON from LLM response: ${content.slice(0, 200)}`);
  }
}
