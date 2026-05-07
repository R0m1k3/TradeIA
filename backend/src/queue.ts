import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { runPipeline } from './agents/orchestrator';
import { runPreMarketAgent } from './agents/pre-market';
import { markToMarket } from './broker/mock';
import { prisma } from './lib/prisma';

export type CycleMode = 'lite' | 'full' | 'pre_market';

const connection = new IORedis(process.env.REDIS_URL || 'redis://redis:6379', {
  maxRetriesPerRequest: null,
});

const QUEUE_NAME = 'trading-pipeline';

let tradingQueue: Queue;

async function isSystemPaused(): Promise<boolean> {
  try {
    const row = await prisma.config.findUnique({ where: { key: 'system_paused' } });
    return row?.value === 'true';
  } catch {
    return false;
  }
}

export function initQueue() {
  tradingQueue = new Queue(QUEUE_NAME, { connection });

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const mode: CycleMode = job.data?.mode ?? 'full';
      console.log(`[Queue] Processing job ${job.id} — ${job.name} (${mode})`);

      if (await isSystemPaused()) {
        console.log('[Queue] System is PAUSED — skipping cycle');
        return { skipped: true, reason: 'system_paused' };
      }

      if (mode === 'lite') {
        // Lite mode: only mark-to-market open positions for trailing stops + SL/TP triggers.
        // No LLM agents = no cost. Runs every 5 min.
        await markToMarket();
        return;
      }

      if (mode === 'pre_market') {
        await runPreMarketAgent();
        return;
      }

      await runPipeline();
    },
    {
      connection,
      concurrency: 1,
      limiter: { max: 2, duration: 60_000 },
    }
  );

  worker.on('completed', (job) => {
    console.log(`[Queue] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Queue] Job ${job?.id} failed:`, err.message);
  });

  const queueEvents = new QueueEvents(QUEUE_NAME, { connection });
  queueEvents.on('error', (err) => {
    console.error('[Queue] QueueEvents error:', err);
  });

  console.log('[Queue] BullMQ worker initialized');
}

export async function addCycleJob(mode: CycleMode = 'full') {
  if (!tradingQueue) {
    console.warn('[Queue] Queue not initialized yet');
    return;
  }

  if (await isSystemPaused()) {
    console.log('[Queue] System is PAUSED — not enqueuing cycle');
    return;
  }

  await tradingQueue.add(
    `trading-cycle-${mode}`,
    { mode },
    {
      removeOnComplete: 50,
      removeOnFail: 20,
      attempts: 1,
    }
  );
}