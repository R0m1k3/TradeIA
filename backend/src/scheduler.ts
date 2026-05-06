import cron from 'node-cron';
import { addCycleJob } from './queue';
import { prisma } from './lib/prisma';
import { getNasdaqStatus } from './routes/market';

function isEnabled(value: string | undefined, fallback = true): boolean {
  if (!value) return fallback;
  return !['false', '0', 'off', 'disabled'].includes(value.toLowerCase());
}

async function cryptoWorkEnabled(): Promise<boolean> {
  const row = await prisma.config.findUnique({ where: { key: 'crypto_work_enabled' } });
  const raw = row?.value || process.env.CRYPTO_WORK_ENABLED;
  return isEnabled(raw, true);
}

export function initScheduler() {
  // Normal market mode runs every 5 minutes. When the market is closed and
  // crypto work is paused, only one light hourly check is allowed.
  cron.schedule('*/5 * * * *', async () => {
    const nasdaq = getNasdaqStatus();
    const cryptoEnabled = await cryptoWorkEnabled();
    const now = new Date();

    if (!nasdaq.isOpen && !cryptoEnabled && now.getMinutes() !== 0) {
      console.log('[Scheduler] Market closed + crypto paused - skipping 5min cycle');
      return;
    }

    const mode = nasdaq.isOpen
      ? (cryptoEnabled ? 'normal (stocks + crypto)' : 'normal (stocks only)')
      : (cryptoEnabled ? 'crypto-only' : 'closed-market hourly check');
    console.log(`[Scheduler] Triggering trading cycle - mode: ${mode}`);
    try {
      await addCycleJob();
    } catch (err) {
      console.error('[Scheduler] Failed to enqueue cycle job:', err);
    }
  });

  cron.schedule('*/15 * * * *', () => {
    console.log('[Scheduler] Heartbeat', new Date().toISOString());
  });

  console.log('[Scheduler] Initialized - 5min market cycles; closed-market crypto mode can be paused from config');

  setTimeout(async () => {
    const nasdaq = getNasdaqStatus();
    const cryptoEnabled = await cryptoWorkEnabled();
    if (!nasdaq.isOpen && !cryptoEnabled) {
      console.log('[Scheduler] Initial cycle skipped - market closed and crypto work paused');
      return;
    }

    const mode = nasdaq.isOpen
      ? (cryptoEnabled ? 'normal (stocks + crypto)' : 'normal (stocks only)')
      : 'crypto-only';
    console.log(`[Scheduler] Running initial cycle on startup - mode: ${mode}`);
    try {
      await addCycleJob();
    } catch (err) {
      console.error('[Scheduler] Initial cycle failed:', err);
    }
  }, 5000);
}
