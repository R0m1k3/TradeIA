import { FastifyPluginAsync } from 'fastify';
import { getHistory } from '../models/ticker-snapshot';
import { getNotes } from '../models/ticker-note';
import { getPrepForDate, getPrepForTicker } from '../models/pre-market';

const tickersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/:ticker/history', async (req) => {
    const { ticker } = req.params as { ticker: string };
    const query = req.query as { interval?: string; from?: string; to?: string };
    const interval = query.interval || '1d';
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86400 * 1000);
    const to = query.to ? new Date(query.to) : new Date();

    const rows = await getHistory(ticker, interval, from, to);
    return { ticker, interval, from: from.toISOString(), to: to.toISOString(), count: rows.length, bars: rows };
  });

  fastify.get('/:ticker/notes', async (req) => {
    const { ticker } = req.params as { ticker: string };
    const query = req.query as { types?: string; limit?: string };
    const types = query.types ? query.types.split(',') : undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : 50;

    const notes = await getNotes(ticker, types, limit);
    return { ticker, notes };
  });

  fastify.get('/prep', async (req) => {
    const query = req.query as { date?: string; ticker?: string };
    if (query.ticker) {
      const items = await getPrepForTicker(query.ticker, 30);
      return { ticker: query.ticker, items };
    }
    const date = query.date || new Date().toISOString().slice(0, 10);
    const items = await getPrepForDate(date);
    return { date, count: items.length, items };
  });
};

export default tickersRoutes;
