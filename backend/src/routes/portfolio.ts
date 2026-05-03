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

  /** Performance stats by trade type (A/B/C) */
  fastify.get('/stats-by-type', async () => {
    const closed = await prisma.trade.findMany({
      where: { closedAt: { not: null }, pnlUsd: { not: null } },
      orderBy: { closedAt: 'desc' },
    });

    const byType: Record<string, { trades: number; wins: number; total_pnl: number; avg_pnl: number; avg_hold_hours: number; win_rate: number }> = {};

    for (const t of closed) {
      const type = t.tradeType || 'unknown';
      if (!byType[type]) byType[type] = { trades: 0, wins: 0, total_pnl: 0, avg_pnl: 0, avg_hold_hours: 0, win_rate: 0 };
      byType[type].trades++;
      if ((t.pnlUsd ?? 0) > 0) byType[type].wins++;
      byType[type].total_pnl += t.pnlUsd ?? 0;
      if (t.closedAt && t.createdAt) {
        const hours = (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60);
        byType[type].avg_hold_hours += hours;
      }
    }

    for (const key of Object.keys(byType)) {
      const bt = byType[key];
      bt.win_rate = bt.trades > 0 ? (bt.wins / bt.trades) * 100 : 0;
      bt.avg_pnl = bt.trades > 0 ? bt.total_pnl / bt.trades : 0;
      bt.avg_hold_hours = bt.trades > 0 ? bt.avg_hold_hours / bt.trades : 0;
    }

    const totalPnl = closed.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
    const totalWins = closed.filter((t) => (t.pnlUsd ?? 0) > 0).length;
    const overallWinRate = closed.length > 0 ? (totalWins / closed.length) * 100 : 0;

    // Drawdown from peak
    let peak = 0;
    let maxDrawdown = 0;
    let runningPnl = 0;
    for (const t of closed.sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime())) {
      runningPnl += t.pnlUsd ?? 0;
      if (runningPnl > peak) peak = runningPnl;
      const dd = peak > 0 ? ((peak - runningPnl) / peak) * 100 : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    return {
      by_type: byType,
      overall: {
        total_trades: closed.length,
        win_rate: overallWinRate,
        total_pnl: totalPnl,
        max_drawdown_pct: maxDrawdown,
      },
    };
  });
};

export default portfolioRoutes;