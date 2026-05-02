import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { invalidateCredential } from '../config/credentials';
import { z } from 'zod';
import axios from 'axios';

const KEYS_TO_INVALIDATE = new Set([
  'openrouter_api_key',
  'alpha_vantage_key',
  'polygon_key',
  'finnhub_key',
  'fred_api_key',
  'socialdata_key',
  'ollama_base_url',
  'portfolio_usd',
  'daily_loss_limit_pct',
  'max_drawdown_pct',
  // Model keys — invalidating cache ensures agents pick up new models on next cycle
  'model_light',
  'model_mid',
  'model_strong',
  'llm_provider',
]);

const configRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    const configs = await prisma.config.findMany();
    const result: Record<string, string> = {};
    const secretsConfigured: Record<string, boolean> = {};

    for (const c of configs) {
      if (KEYS_TO_INVALIDATE.has(c.key)) {
        if (['openrouter_api_key', 'alpha_vantage_key', 'polygon_key', 'finnhub_key', 'fred_api_key', 'socialdata_key'].includes(c.key)) {
          secretsConfigured[c.key] = c.value.length > 0;
        } else {
          result[c.key] = c.value;
        }
      } else {
        result[c.key] = c.value;
      }
    }

    // Ensure all sensitive keys appear in secrets_configured
    for (const key of ['openrouter_api_key', 'alpha_vantage_key', 'polygon_key', 'finnhub_key', 'fred_api_key', 'socialdata_key']) {
      if (!(key in secretsConfigured)) secretsConfigured[key] = false;
    }

    return {
      ...result,
      // Env defaults (non-sensitive), overridden by DB values if present
      llm_provider: result.llm_provider || process.env.LLM_PROVIDER || 'openrouter',
      model_light: result.model_light || process.env.MODEL_LIGHT || '',
      model_mid: result.model_mid || process.env.MODEL_MID || '',
      model_strong: result.model_strong || process.env.MODEL_STRONG || '',
      watchlist: result.watchlist || process.env.WATCHLIST || '',
      portfolio_usd: result.portfolio_usd || process.env.PORTFOLIO_USD || '',
      daily_loss_limit_pct: result.daily_loss_limit_pct || process.env.DAILY_LOSS_LIMIT_PCT || '',
      max_drawdown_pct: result.max_drawdown_pct || '10',
      mock_broker: result.mock_broker || process.env.MOCK_BROKER || '',
      secrets_configured: secretsConfigured,
    };
  });

  fastify.post('/', async (req) => {
    const schema = z.record(z.string());
    const body = schema.parse(req.body);
    const updated: string[] = [];

    for (const [key, value] of Object.entries(body)) {
      // Do NOT overwrite existing non-empty DB values with empty strings.
      // This prevents the UI from erasing saved credentials when models aren't loaded yet.
      if (value.trim() === '') {
        const existing = await prisma.config.findUnique({ where: { key } });
        if (existing && existing.value.trim() !== '') {
          console.log(`[Config] Skipping empty value for key: ${key} (preserving existing)`);
          continue;
        }
      }

      console.log(`[Config] Updating key: ${key} (length: ${value.length})`);
      await prisma.config.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
      updated.push(key);

      if (KEYS_TO_INVALIDATE.has(key)) {
        invalidateCredential(key);
      }
    }

    return { success: true, updated };
  });

  fastify.get('/llm-models', async (req) => {
    const provider = (await prisma.config.findUnique({ where: { key: 'llm_provider' } }))?.value || process.env.LLM_PROVIDER || 'openrouter';
    
    console.log(`[Config] Fetching models for provider: ${provider}`);

    if (provider === 'ollama') {
      try {
        let baseUrl = (await prisma.config.findUnique({ where: { key: 'ollama_base_url' } }))?.value
          || process.env.OLLAMA_BASE_URL
          || 'http://ollama:11434';
        // Strip trailing slash
        baseUrl = baseUrl.replace(/\/+$/, '');
        const res = await axios.get(`${baseUrl}/api/tags`, { timeout: 15000 });
        const models = (res.data.models || []).map((m: any) => m.name);
        console.log(`[Config] Fetched ${models.length} Ollama models from ${baseUrl}`);
        return models;
      } catch (err: any) {
        console.error('[Config] Ollama models fetch failed:', err.message);
        return [];
      }
    } else {
      // Try to get the API key to authenticate the request (expands available models)
      const apiKey = (await prisma.config.findUnique({ where: { key: 'openrouter_api_key' } }))?.value
        || process.env.OPENROUTER_API_KEY
        || '';

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://trade.ffnancy.fr',
        'X-Title': 'TradeIA',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
        console.log('[Config] Using API key for OpenRouter models request');
      } else {
        console.warn('[Config] No OpenRouter API key found — fetching public models list');
      }

      try {
        const res = await axios.get('https://openrouter.ai/api/v1/models', {
          timeout: 15000,
          headers,
        });

        if (!res.data?.data || !Array.isArray(res.data.data)) {
          console.error('[Config] Unexpected OpenRouter response format:', JSON.stringify(res.data).substring(0, 200));
          throw new Error('Invalid response format from OpenRouter');
        }

        const models: string[] = res.data.data
          .map((m: any) => m.id as string)
          .filter((id: string) => typeof id === 'string' && id.length > 0)
          .sort();

        console.log(`[Config] Successfully fetched ${models.length} models from OpenRouter`);
        return models;
      } catch (err: any) {
        console.error('[Config] OpenRouter models fetch failed:', err.message);
        // Return a curated fallback list so the UI is never empty
        return [
          'anthropic/claude-3.5-haiku',
          'anthropic/claude-3.5-sonnet',
          'anthropic/claude-3-haiku',
          'anthropic/claude-opus-4',
          'google/gemini-2.0-flash-001',
          'google/gemini-flash-1.5',
          'meta-llama/llama-3.3-70b-instruct',
          'meta-llama/llama-3.1-8b-instruct:free',
          'mistralai/mistral-7b-instruct:free',
          'openai/gpt-4o',
          'openai/gpt-4o-mini',
          'openai/o1-mini',
          'qwen/qwen-2.5-72b-instruct',
        ];
      }
    }
  });

  fastify.post('/test-llm', async (req, reply) => {
    try {
      const { getModels } = await import('../llm/models');
      const { callLLM } = await import('../llm/client');
      const { getCredential } = await import('../config/credentials');
      const models = await getModels();
      const provider = await getCredential('llm_provider', 'LLM_PROVIDER') || 'openrouter';

      // For Ollama: verify connection first, then pick a valid model
      if (provider === 'ollama') {
        const baseUrl = (await getCredential('ollama_base_url', 'OLLAMA_BASE_URL') || 'http://ollama:11434').replace(/\/+$/, '');

        // Step 1: check Ollama is reachable
        try {
          const tagsRes = await axios.get(`${baseUrl}/api/tags`, { timeout: 10000 });
          const availableModels: string[] = (tagsRes.data.models || []).map((m: any) => m.name);

          if (availableModels.length === 0) {
            return { success: false, message: `Ollama reachable at ${baseUrl} but no models installed. Run: ollama pull qwen2.5:7b`, provider, models_available: [] };
          }

          // Step 2: use configured model if it exists, otherwise pick the first available
          let testModel = models.LIGHT;
          if (!availableModels.includes(testModel)) {
            testModel = availableModels[0];
            console.log(`[Config] Configured model ${models.LIGHT} not found, using ${testModel}`);
          }

          // Step 3: test chat
          const start = Date.now();
          const result = await callLLM('test-ping', testModel, 'You are a tester.', 'Say "OK"');
          const duration = Date.now() - start;

          return {
            success: true,
            message: `Ollama connected (${duration}ms)`,
            provider,
            model: testModel,
            models_available: availableModels,
            response: result.content,
          };
        } catch (connErr: any) {
          const msg = connErr.code === 'ECONNREFUSED' ? `Cannot reach ${baseUrl}` :
                      connErr.code === 'ETIMEDOUT' ? `Timeout connecting to ${baseUrl}` :
                      connErr.response?.status ? `HTTP ${connErr.response.status} from ${baseUrl}` :
                      connErr.message;
          return { success: false, message: `Ollama connection failed: ${msg}`, provider };
        }
      }

      // OpenRouter test
      const testModel = models.LIGHT;
      console.log(`[Config] Testing LLM: provider=${provider} model=${testModel}`);

      const start = Date.now();
      const result = await callLLM('test-ping', testModel, 'You are a tester.', 'Say "OK"');
      const duration = Date.now() - start;

      return {
        success: true,
        message: `Connection successful (${duration}ms)`,
        provider,
        model: testModel,
        response: result.content,
      };
    } catch (err: any) {
      console.error('[Config] LLM Test failed:', err.message);
      reply.status(500);
      return {
        success: false,
        message: err.message || 'Unknown error'
      };
    }
  });
};

export default configRoutes;
