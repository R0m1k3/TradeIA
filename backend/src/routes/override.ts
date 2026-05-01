import { FastifyPluginAsync } from 'fastify';
import { broadcastOverrideAck } from '../websocket';
import { closeTrade } from '../broker/mock';
import { prisma } from '../lib/prisma';

const overrideRoutes: FastifyPluginAsync = async (fastify) => {
  // Pause/Resume — no auth required
  fastify.post('/pause', async () => {
    await prisma.config.upsert({
      where: { key: 'system_paused' },
      update: { value: 'true' },
      create: { key: 'system_paused', value: 'true' },
    });
    broadcastOverrideAck('PAUSE', 'SYSTEM');
    console.log('[Override] System PAUSED');
    return { success: true, action: 'SYSTEM_PAUSED' };
  });

  fastify.post('/resume', async () => {
    await prisma.config.upsert({
      where: { key: 'system_paused' },
      update: { value: 'false' },
      create: { key: 'system_paused', value: 'false' },
    });
    broadcastOverrideAck('RESUME', 'SYSTEM');
    console.log('[Override] System RESUMED');
    return { success: true, action: 'SYSTEM_RESUMED' };
  });

  // Close/Block — require admin password
  fastify.addHook('preHandler', async (req, reply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const [scheme, credentials] = authHeader.split(' ');
    if (scheme !== 'Basic') {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const decoded = Buffer.from(credentials || '', 'base64').toString('utf8');
    const [, password] = decoded.split(':');
    if (password !== (process.env.ADMIN_PASSWORD || 'changeme')) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  fastify.post('/close/:ticker', async (req, reply) => {
    const { ticker } = req.params as { ticker: string };

    const openTrade = await prisma.trade.findFirst({
      where: { ticker, closedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!openTrade) {
      return reply.code(404).send({ error: `No open position for ${ticker}` });
    }

    await closeTrade(openTrade.id, openTrade.filledPrice, 'MANUAL');
    broadcastOverrideAck('CLOSE', ticker);
    return { success: true, action: 'POSITION_CLOSED', ticker };
  });

  fastify.post('/block/:ticker', async (req) => {
    const { ticker } = req.params as { ticker: string };
    await prisma.config.upsert({
      where: { key: `blocked:${ticker}` },
      update: { value: 'true' },
      create: { key: `blocked:${ticker}`, value: 'true' },
    });
    broadcastOverrideAck('BLOCK', ticker);
    return { success: true, action: 'TICKER_BLOCKED', ticker };
  });

  fastify.post('/unblock/:ticker', async (req) => {
    const { ticker } = req.params as { ticker: string };
    await prisma.config.upsert({
      where: { key: `blocked:${ticker}` },
      update: { value: 'false' },
      create: { key: `blocked:${ticker}`, value: 'false' },
    });
    broadcastOverrideAck('UNBLOCK', ticker);
    return { success: true, action: 'TICKER_UNBLOCKED', ticker };
  });
};

export default overrideRoutes;