import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../index';

const signalsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    const recent = await prisma.cycleLog.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    if (!recent) return { signals: [], market: {} };

    const payload = recent.payload as {
      debateOutputs?: unknown[];
      finalPortfolio?: unknown;
    };

    return {
      signals: payload.debateOutputs || [],
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
