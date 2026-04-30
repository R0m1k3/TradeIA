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
  'ollama_base_url',
  'portfolio_usd',
  'daily_loss_limit_pct',
]);

const configRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    const configs = await prisma.config.findMany();
    const result: Record<string, string> = {};
    const secretsConfigured: Record<string, boolean> = {};

    for (const c of configs) {
      if (KEYS_TO_INVALIDATE.has(c.key)) {
        if (['openrouter_api_key', 'alpha_vantage_key', 'polygon_key', 'finnhub_key'].includes(c.key)) {
          secretsConfigured[c.key] = c.value.length > 0;
        } else {
          result[c.key] = c.value;
        }
      } else {
        result[c.key] = c.value;
      }
    }

    // Ensure all sensitive keys appear in secrets_configured
    for (const key of ['openrouter_api_key', 'alpha_vantage_key', 'polygon_key', 'finnhub_key']) {
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
      mock_broker: result.mock_broker || process.env.MOCK_BROKER || '',
      secrets_configured: secretsConfigured,
    };
  });

  fastify.post('/', async (req) => {
    const schema = z.record(z.string());
    const body = schema.parse(req.body);

    for (const [key, value] of Object.entries(body)) {
      console.log(`[Config] Updating key: ${key} (length: ${value.length})`);
      await prisma.config.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });

      if (KEYS_TO_INVALIDATE.has(key)) {
        invalidateCredential(key);
      }
    }

    return { success: true, updated: Object.keys(body) };
  });

  fastify.get('/llm-models', async () => {
    const provider = (await prisma.config.findUnique({ where: { key: 'llm_provider' } }))?.value || process.env.LLM_PROVIDER || 'openrouter';
    
    console.log(`[Config] Fetching models for provider: ${provider}`);

    if (provider === 'ollama') {
      try {
        const baseUrl = (await prisma.config.findUnique({ where: { key: 'ollama_base_url' } }))?.value || process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
        const res = await axios.get(`${baseUrl}/api/tags`, { timeout: 5000 });
        return (res.data.models || []).map((m: any) => m.name);
      } catch (err: any) {
        console.error('[Config] Ollama models fetch failed:', err.message);
        return ['qwen2.5:7b', 'llama3.1:8b']; 
      }
    } else {
      try {
        const res = await axios.get('https://openrouter.ai/api/v1/models', { 
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (!res.data?.data) {
          throw new Error('Invalid response format from OpenRouter');
        }

        const models = res.data.data.map((m: any) => m.id).sort();
        console.log(`[Config] Successfully fetched ${models.length} models from OpenRouter`);
        return models;
      } catch (err: any) {
        console.error('[Config] OpenRouter models fetch failed:', err.message);
        return [
          'anthropic/claude-3.5-sonnet',
          'anthropic/claude-3-haiku',
          'openai/gpt-4o-mini',
          'openai/gpt-4o',
          'meta-llama/llama-3.1-405b'
        ]; 
      }
    }
  });
};

export default configRoutes;
