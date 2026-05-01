import { FastifyPluginAsync } from 'fastify';
import { getMarketContext } from '../data/finnhub';

const marketRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/context', async () => {
    const context = await getMarketContext();
    return {
      vix: context.vix,
      fear_greed: context.fear_greed,
      nasdaq: context.nasdaq_direction,
    };
  });
};

export default marketRoutes;