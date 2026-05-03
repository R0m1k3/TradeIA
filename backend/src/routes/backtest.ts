import { FastifyPluginAsync } from 'fastify';
import { runBacktest, detectStrategyDecay } from '../broker/backtest';
import type { BacktestBar } from '../broker/backtest';
import type { ApprovedOrder } from '../broker/mock';
import { getYahooOHLCV } from '../data/yahoo';

const backtestRoute: FastifyPluginAsync = async (app) => {
  /**
   * POST /api/backtest
   * Run a backtest for a ticker using historical data + order proposals.
   * Body: { ticker: string, orders: ApprovedOrder[], days?: number }
   */
  app.post<{
    Body: {
      ticker: string;
      orders: ApprovedOrder[];
      days?: number;
      initial_capital?: number;
    };
  }>('/api/backtest', async (req, reply) => {
    const { ticker, orders, days = 90, initial_capital = 10000 } = req.body;

    if (!ticker) {
      return reply.status(400).send({ error: 'ticker is required' });
    }

    try {
      // Fetch historical bars (daily interval for backtesting)
      const bars = await getYahooOHLCV(ticker, '1d', `${days}d`);
      if (!bars || bars.length < 20) {
        return reply.status(404).send({ error: `Not enough data for ${ticker}` });
      }

      // Filter orders for this ticker
      const tickerOrders = orders.filter((o) => o.ticker === ticker);

      const result = runBacktest(
        bars.map((b) => ({
          time: b.time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        })),
        tickerOrders,
        initial_capital
      );

      return reply.send(result);
    } catch (err) {
      console.error('[Backtest] Error:', err);
      return reply.status(500).send({ error: 'Backtest failed' });
    }
  });

  /**
   * GET /api/backtest/decay
   * Detect strategy decay by comparing recent vs historical performance.
   */
  app.get('/api/backtest/decay', async (_req, reply) => {
    const result = await detectStrategyDecay();
    return reply.send(result);
  });
};

export default backtestRoute;