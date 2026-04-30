import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient } from '@prisma/client';
import { initWebSocket } from './websocket';
import { initScheduler } from './scheduler';
import { initQueue } from './queue';
import { initCredentials, warmCredentialsCache } from './config/credentials';
import { prisma } from './lib/prisma';
import portfolioRoutes from './routes/portfolio';
import signalsRoutes from './routes/signals';
import configRoutes from './routes/config';
import overrideRoutes from './routes/override';

const app = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  },
});

async function main() {
  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
  });

  await app.register(portfolioRoutes, { prefix: '/api/portfolio' });
  await app.register(signalsRoutes, { prefix: '/api/signals' });
  await app.register(configRoutes, { prefix: '/api/config' });
  await app.register(overrideRoutes, { prefix: '/api/override' });

  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  initCredentials(prisma);
  await warmCredentialsCache();

  const server = await app.listen({ port: parseInt(process.env.PORT || '4000'), host: '0.0.0.0' });
  app.log.info(`Backend listening on ${server}`);

  initWebSocket(app.server);
  initQueue();
  initScheduler();
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
