import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { getPortfolioState } from '../broker/mock';
import { getCredential } from '../config/credentials';

const portfolioRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    const portfolioUsdRaw = await getCredential('portfolio_usd', 'PORTFOLIO_USD');
    const portfolioUsd = parseFloat(portfolioUsdRaw || '10000');
    const state = await getPortfolioState(portfolioUsd);
    return state;
  });

  fastify.get('/trades', async (req) => {
    const query = req.query as { limit?: string; open?: string };
    const limit = parseInt(query.limit || '50');

    const where = query.open === 'true' ? { closedAt: null } : {};
    const trades = await prisma.trade.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return trades;
  });

  fastify.get('/history', async () => {
    const trades = await prisma.trade.findMany({
      where: { closedAt: { not: null } },
      orderBy: { closedAt: 'desc' },
      take: 100,
    });
    return trades;
  });

  fastify.get('/cycles', async () => {
    const cycles = await prisma.cycleLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, ordersCount: true, alertsCount: true, durationMs: true, createdAt: true },
    });
    return cycles;
  });
};

export default portfolioRoutes;