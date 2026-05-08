import { FastifyPluginAsync } from 'fastify';
import { getHistory } from '../models/ticker-snapshot';
import { getNotes } from '../models/ticker-note';
import { getPrepForDate, getPrepForTicker } from '../models/pre-market';
import { getYahooOHLCV } from '../data/yahoo';

function daysToRange(days: number): string {
  if (days <= 5) return '5d';
  if (days <= 30) return '1mo';
  if (days <= 90) return '3mo';
  if (days <= 180) return '6mo';
  if (days <= 365) return '1y';
  return '2y';
}

const tickersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/:ticker/history', async (req) => {
    const { ticker } = req.params as { ticker: string };
    const query = req.query as { interval?: string; from?: string; to?: string };
    const interval = query.interval || '1d';
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86400 * 1000);
    const to = query.to ? new Date(query.to) : new Date();

    let rows = await getHistory(ticker, interval, from, to);

    // Fallback to Yahoo Finance if DB has no data for this ticker
    if (rows.length === 0 && (interval === '1d' || interval === '1h' || interval === '15m')) {
      const validInterval = (interval === '1d' || interval === '1h' || interval === '15m') ? interval : '1d';
      const days = Math.ceil((to.getTime() - from.getTime()) / 86400000);
      const range = daysToRange(days);
      const yahooInterval = validInterval as '15m' | '1h' | '1d';
      const bars = await getYahooOHLCV(ticker, yahooInterval, range);
      rows = bars
        .filter((b) => new Date(b.time) >= from && new Date(b.time) <= to)
        .map((b) => ({ time: new Date(b.time), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? null }));
    }

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
