import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { runPipeline } from './agents/orchestrator';
import { prisma } from './lib/prisma';

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
      console.log(`[Queue] Processing job ${job.id} — ${job.name}`);

      if (await isSystemPaused()) {
        console.log('[Queue] System is PAUSED — skipping cycle');
        return { skipped: true, reason: 'system_paused' };
      }

      await runPipeline();
    },
    {
      connection,
      concurrency: 1,
      limiter: { max: 1, duration: 60_000 },
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

export async function addCycleJob() {
  if (!tradingQueue) {
    console.warn('[Queue] Queue not initialized yet');
    return;
  }

  if (await isSystemPaused()) {
    console.log('[Queue] System is PAUSED — not enqueuing cycle');
    return;
  }

  await tradingQueue.add(
    'trading-cycle',
    {},
    {
      removeOnComplete: 50,
      removeOnFail: 20,
      attempts: 1,
    }
  );
}