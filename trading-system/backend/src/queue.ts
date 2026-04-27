import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { runPipeline } from './agents/orchestrator';

const connection = new IORedis(process.env.REDIS_URL || 'redis://redis:6379', {
  maxRetriesPerRequest: null,
});

const QUEUE_NAME = 'trading-pipeline';

let tradingQueue: Queue;

export function initQueue() {
  tradingQueue = new Queue(QUEUE_NAME, { connection });

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`[Queue] Processing job ${job.id} — ${job.name}`);
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
