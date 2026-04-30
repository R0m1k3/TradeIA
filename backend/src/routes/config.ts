import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { invalidateCredential } from '../config/credentials';
import { z } from 'zod';

const SENSITIVE_KEYS = new Set([
  'openrouter_api_key',
  'alpha_vantage_key',
  'polygon_key',
  'finnhub_key',
]);

const configRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    const configs = await prisma.config.findMany();
    const result: Record<string, string> = {};
    const secretsConfigured: Record<string, boolean> = {};

    for (const c of configs) {
      if (SENSITIVE_KEYS.has(c.key)) {
        secretsConfigured[c.key] = c.value.length > 0;
      } else {
        result[c.key] = c.value;
      }
    }

    // Ensure all sensitive keys appear in secrets_configured (false if not in DB)
    for (const key of SENSITIVE_KEYS) {
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
      await prisma.config.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });

      if (SENSITIVE_KEYS.has(key)) {
        invalidateCredential(key);
      }
    }

    return { success: true, updated: Object.keys(body) };
  });

  fastify.get('/llm-models', async () => {
    const provider = (await prisma.config.findUnique({ where: { key: 'llm_provider' } }))?.value || process.env.LLM_PROVIDER || 'openrouter';
    
    if (provider === 'ollama') {
      try {
        const baseUrl = (await prisma.config.findUnique({ where: { key: 'ollama_base_url' } }))?.value || process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
        const { default: axios } = await import('axios');
        const res = await axios.get(`${baseUrl}/api/tags`);
        return (res.data.models || []).map((m: any) => m.name);
      } catch {
        return ['qwen2.5:7b', 'llama3.1:8b']; // Fallback
      }
    } else {
      try {
        const { default: axios } = await import('axios');
        const res = await axios.get('https://openrouter.ai/api/v1/models');
        return (res.data.data || []).map((m: any) => m.id).sort();
      } catch {
        return ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini']; // Fallback
      }
    }
  });
};

export default configRoutes;
