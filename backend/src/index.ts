import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient } from '@prisma/client';
import { initWebSocket } from './websocket';
import { startLiveStateStream } from './live-state';
import { initScheduler } from './scheduler';
import { initQueue } from './queue';
import { initCredentials, warmCredentialsCache } from './config/credentials';
import { prisma } from './lib/prisma';
import portfolioRoutes from './routes/portfolio';
import signalsRoutes from './routes/signals';
import configRoutes from './routes/config';
import overrideRoutes from './routes/override';
import orchestratorRoutes from './routes/orchestrator';
import marketRoutes from './routes/market';
import healthRoutes from './routes/health';
import backtestRoutes from './routes/backtest';
import tickersRoutes from './routes/tickers';

const app = Fastify({
  logger: true,
});

async function ensureMigrations() {
  // Idempotent: create tables added in 20260508 migration if they don't exist yet.
  // Guards against servers running an image built before this migration was added.
  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "TickerSnapshot" (
        "id"        TEXT NOT NULL,
        "ticker"    TEXT NOT NULL,
        "interval"  TEXT NOT NULL,
        "time"      TIMESTAMP(3) NOT NULL,
        "open"      DOUBLE PRECISION NOT NULL,
        "high"      DOUBLE PRECISION NOT NULL,
        "low"       DOUBLE PRECISION NOT NULL,
        "close"     DOUBLE PRECISION NOT NULL,
        "volume"    DOUBLE PRECISION,
        "source"    TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "TickerSnapshot_pkey" PRIMARY KEY ("id")
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "TickerSnapshot_ticker_time_idx" ON "TickerSnapshot"("ticker", "time")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "TickerSnapshot_ticker_interval_time_idx" ON "TickerSnapshot"("ticker", "interval", "time")`;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "TickerNote" (
        "id"         TEXT NOT NULL,
        "ticker"     TEXT NOT NULL,
        "noteType"   TEXT NOT NULL,
        "content"    TEXT NOT NULL,
        "confidence" INTEGER,
        "cycleId"    TEXT,
        "metadata"   JSONB,
        "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "TickerNote_pkey" PRIMARY KEY ("id")
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "TickerNote_ticker_noteType_createdAt_idx" ON "TickerNote"("ticker", "noteType", "createdAt")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "TickerNote_createdAt_idx" ON "TickerNote"("createdAt")`;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "PreMarketPrep" (
        "id"             TEXT NOT NULL,
        "date"           TEXT NOT NULL,
        "ticker"         TEXT NOT NULL,
        "closePrev"      DOUBLE PRECISION NOT NULL,
        "vixPrev"        DOUBLE PRECISION,
        "macroSummary"   TEXT,
        "setupSignal"    TEXT NOT NULL,
        "confidence"     INTEGER NOT NULL,
        "reasoning"      TEXT NOT NULL,
        "executedAtOpen" BOOLEAN NOT NULL DEFAULT false,
        "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PreMarketPrep_pkey" PRIMARY KEY ("id")
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "PreMarketPrep_date_ticker_idx" ON "PreMarketPrep"("date", "ticker")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "PreMarketPrep_date_setupSignal_idx" ON "PreMarketPrep"("date", "setupSignal")`;

    console.log('[Main] ensureMigrations: tables OK');
  } catch (err) {
    console.error('[Main] ensureMigrations failed:', (err as Error).message);
  }
}

async function main() {
  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: 600,
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
  await app.register(orchestratorRoutes, { prefix: '/api/orchestrator' });
  await app.register(marketRoutes, { prefix: '/api/market' });

  await app.register(healthRoutes, { prefix: '/api/health' });
  await app.register(backtestRoutes, { prefix: '/api/backtest' });
  await app.register(tickersRoutes, { prefix: '/api/tickers' });

  initCredentials(prisma);
  await warmCredentialsCache();
  await ensureMigrations();
  const configCount = await prisma.config.count();
  console.log(`[Main] Persistence check: ${configCount} configuration keys loaded from database.`);

  const server = await app.listen({ port: parseInt(process.env.PORT || '4000'), host: '0.0.0.0' });
  app.log.info(`Backend listening on ${server}`);

  initWebSocket(app.server);
  startLiveStateStream();
  initQueue();
  initScheduler();
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
