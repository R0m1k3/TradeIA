import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';

interface DebateOutput {
  ticker: string;
  debate_score: number;
  bull: { conviction: number; technical_case?: string };
  bear: { conviction: number };
  analyst_output: { confidence: number };
}

const signalsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    const recent = await prisma.cycleLog.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    if (!recent) return { signals: [], market: {} };

    const payload = recent.payload as {
      debateOutputs?: DebateOutput[];
      finalPortfolio?: unknown;
    };

    const debates = payload.debateOutputs || [];
    const signals = debates.map((d) => ({
      ticker: d.ticker,
      signal: d.debate_score >= 1 ? 'BUY' : d.debate_score <= -2 ? 'SELL' : 'HOLD',
      debate_score: d.debate_score,
      bull_conviction: d.bull?.conviction || 0,
      bear_conviction: d.bear?.conviction || 0,
      confidence: d.analyst_output?.confidence || 0,
      reasoning: d.bull?.technical_case?.slice(0, 80) || '',
    }));

    return {
      signals,
      updatedAt: recent.createdAt,
    };
  });

  fastify.get('/latest-cycle', async () => {
    const cycle = await prisma.cycleLog.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    return cycle || { message: 'No cycles yet' };
  });
};

export default signalsRoutes;
