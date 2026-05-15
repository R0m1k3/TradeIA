import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';

interface DecisionMetadata {
  action?: 'BUY' | 'SELL' | 'HOLD';
  size_pct?: number;
  limit_price?: number;
  stop_loss?: number;
  take_profit?: number;
  trade_type?: string;
  bull_case?: string;
  bear_case?: string;
  key_risk?: string;
  invalidation?: string;
  inputs_seen?: {
    news_count?: number;
    news_positive?: number;
    news_negative?: number;
    has_calibration?: boolean;
    calibration_wr?: number;
    is_held?: boolean;
    segment?: string;
  };
}

/**
 * Routes /api/decisions
 *
 * Expose les décisions LLM du Decider (action BUY/SELL/HOLD avec reasoning
 * et inputs vus) pour la page Agents du frontend.
 */
const decisionsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/decisions/latest — dernières décisions du cycle le plus récent
  fastify.get('/latest', async () => {
    // Trouve l'horodatage du dernier cycle (basé sur la dernière note "decision")
    const lastNote = await prisma.tickerNote.findFirst({
      where: { noteType: 'decision' },
      orderBy: { createdAt: 'desc' },
    });

    if (!lastNote) {
      return { decisions: [], cycleAt: null };
    }

    // Toutes les notes "decision" du même cycle (±30 secondes)
    const cycleStart = new Date(lastNote.createdAt.getTime() - 30_000);
    const cycleEnd = new Date(lastNote.createdAt.getTime() + 30_000);

    const notes = await prisma.tickerNote.findMany({
      where: {
        noteType: 'decision',
        createdAt: { gte: cycleStart, lte: cycleEnd },
      },
      orderBy: { createdAt: 'desc' },
    });

    const decisions = notes.map((n) => {
      const meta = (n.metadata as DecisionMetadata) || {};
      return {
        ticker: n.ticker,
        action: meta.action ?? 'HOLD',
        confidence: n.confidence ?? 0,
        reasoning: n.content,
        size_pct: meta.size_pct ?? 0,
        limit_price: meta.limit_price ?? 0,
        stop_loss: meta.stop_loss ?? 0,
        take_profit: meta.take_profit ?? 0,
        trade_type: meta.trade_type,
        bull_case: meta.bull_case ?? '',
        bear_case: meta.bear_case ?? '',
        key_risk: meta.key_risk ?? '',
        invalidation: meta.invalidation ?? '',
        inputs_seen: meta.inputs_seen ?? {},
        timestamp: n.createdAt,
      };
    });

    return { decisions, cycleAt: lastNote.createdAt };
  });

  // GET /api/decisions/ticker/:ticker — historique des décisions sur un ticker
  fastify.get<{ Params: { ticker: string } }>('/ticker/:ticker', async (req) => {
    const ticker = req.params.ticker.toUpperCase();
    const notes = await prisma.tickerNote.findMany({
      where: { noteType: 'decision', ticker },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const decisions = notes.map((n) => {
      const meta = (n.metadata as DecisionMetadata) || {};
      return {
        ticker: n.ticker,
        action: meta.action ?? 'HOLD',
        confidence: n.confidence ?? 0,
        reasoning: n.content,
        size_pct: meta.size_pct ?? 0,
        limit_price: meta.limit_price ?? 0,
        stop_loss: meta.stop_loss ?? 0,
        take_profit: meta.take_profit ?? 0,
        bull_case: meta.bull_case ?? '',
        bear_case: meta.bear_case ?? '',
        key_risk: meta.key_risk ?? '',
        invalidation: meta.invalidation ?? '',
        timestamp: n.createdAt,
      };
    });

    return { ticker, decisions };
  });
};

export default decisionsRoutes;
