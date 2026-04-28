import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../index';
import { z } from 'zod';

const configRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    const configs = await prisma.config.findMany();
    const result: Record<string, string> = {};
    for (const c of configs) result[c.key] = c.value;
    return {
      ...result,
      // Include env defaults (non-sensitive)
      llm_provider: process.env.LLM_PROVIDER || 'openrouter',
      model_light: process.env.MODEL_LIGHT,
      model_mid: process.env.MODEL_MID,
      model_strong: process.env.MODEL_STRONG,
      watchlist: process.env.WATCHLIST,
      portfolio_usd: process.env.PORTFOLIO_USD,
      daily_loss_limit_pct: process.env.DAILY_LOSS_LIMIT_PCT,
      mock_broker: process.env.MOCK_BROKER,
    };
  });

  fastify.post('/', async (req, reply) => {
    const schema = z.record(z.string());
    const body = schema.parse(req.body);

    for (const [key, value] of Object.entries(body)) {
      await prisma.config.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }

    return { success: true, updated: Object.keys(body) };
  });
};

export default configRoutes;
