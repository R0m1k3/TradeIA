import axios, { AxiosError } from 'axios';

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

async function callOpenRouter(model: string, messages: LLMMessage[]): Promise<LLMResponse> {
  const start = Date.now();
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages,
      temperature: 0.1,
      max_tokens: 4096,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nexus-trade.local',
        'X-Title': 'Nexus Trade AI',
      },
      timeout: 30_000,
    }
  );

  const content = response.data.choices?.[0]?.message?.content || '';
  const tokensUsed = response.data.usage?.total_tokens || 0;
  return { content: stripMarkdownJson(content), tokensUsed, durationMs: Date.now() - start };
}

async function callOllama(model: string, messages: LLMMessage[]): Promise<LLMResponse> {
  const start = Date.now();
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
  const response = await axios.post(
    `${baseUrl}/api/chat`,
    {
      model,
      messages,
      stream: false,
      options: { temperature: 0.1 },
    },
    { timeout: 30_000 }
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
  userContent: string
): Promise<LLMResponse> {
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  const provider = process.env.LLM_PROVIDER || 'openrouter';
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const result =
        provider === 'ollama'
          ? await callOllama(model, messages)
          : await callOpenRouter(model, messages);

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
      console.error(
        `[LLM] ${agentName} attempt ${attempt + 1}/3 failed — status ${status}: ${axiosErr.message}`
      );
      if (attempt < 3) {
        await sleep(delays[attempt] || 4000);
      } else {
        throw new Error(`LLM call failed after 3 retries for agent ${agentName}: ${axiosErr.message}`);
      }
    }
  }

  throw new Error('Unreachable');
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
