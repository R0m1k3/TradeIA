import { FastifyPluginAsync } from 'fastify';
import { runBacktest, detectStrategyDecay, runWalkForwardBacktest } from '../broker/backtest';
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

  /**
   * POST /api/backtest/walk-forward
   * Walk-forward backtest: fenêtres roulantes train/test pour détecter l'overfitting.
   * Body: { ticker, orders, initial_capital?, train_days?, test_days? }
   */
  app.post<{
    Body: {
      ticker: string;
      orders: ApprovedOrder[];
      initial_capital?: number;
      train_days?: number;
      test_days?: number;
    };
  }>('/api/backtest/walk-forward', async (req, reply) => {
    const { ticker, orders, initial_capital = 10000, train_days = 90, test_days = 30 } = req.body;

    if (!ticker) return reply.status(400).send({ error: 'ticker requis' });

    try {
      // 2 ans de données daily pour avoir assez de fenêtres
      const bars = await getYahooOHLCV(ticker, '1d', '730d');
      if (!bars || bars.length < train_days + test_days) {
        return reply.status(404).send({ error: `Données insuffisantes pour ${ticker} (${bars?.length ?? 0} barres)` });
      }

      const result = runWalkForwardBacktest(
        bars.map((b) => ({
          time: b.time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        })),
        orders,
        initial_capital,
        train_days,
        test_days
      );

      return reply.send(result);
    } catch (err) {
      console.error('[Backtest/WF] Error:', err);
      return reply.status(500).send({ error: 'Walk-forward backtest échoué' });
    }
  });
};

export default backtestRoute;