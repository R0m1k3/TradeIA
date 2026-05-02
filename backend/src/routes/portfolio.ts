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

  fastify.get('/ai-performance', async () => {
    try {
      const all = await (prisma as any).agentPrediction.findMany({
        where: { resolvedAt: { not: null } },
      });

      if (all.length === 0) {
        return { total: 0, resolved: 0, correct: 0, win_rate: 0, by_direction: { BUY: { total: 0, correct: 0 }, SELL: { total: 0, correct: 0 }, HOLD: { total: 0, correct: 0 } } };
      }

      const byDir: Record<string, { total: number; correct: number }> = {
        BUY: { total: 0, correct: 0 },
        SELL: { total: 0, correct: 0 },
        HOLD: { total: 0, correct: 0 },
      };

      let correctTotal = 0;
      for (const p of all) {
        const dir = p.predictedDirection as string;
        if (!byDir[dir]) byDir[dir] = { total: 0, correct: 0 };
        byDir[dir].total++;
        if (p.correct) {
          byDir[dir].correct++;
          correctTotal++;
        }
      }

      const totalAll = await (prisma as any).agentPrediction.count();

      return {
        total: totalAll,
        resolved: all.length,
        correct: correctTotal,
        win_rate: all.length > 0 ? (correctTotal / all.length) * 100 : 0,
        by_direction: byDir,
      };
    } catch {
      return { total: 0, resolved: 0, correct: 0, win_rate: 0, by_direction: { BUY: { total: 0, correct: 0 }, SELL: { total: 0, correct: 0 }, HOLD: { total: 0, correct: 0 } } };
    }
  });
};

export default portfolioRoutes;