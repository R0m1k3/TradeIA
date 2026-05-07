import cron from 'node-cron';
import { addCycleJob } from './queue';
import { getNasdaqStatus } from './routes/market';

export function initScheduler() {
  cron.schedule('*/5 * * * *', async () => {
    const nasdaq = getNasdaqStatus();
    const now = new Date();

    const usOrEuOpen = nasdaq.isOpen || isEuropeanMarketOpen(now);
    if (!usOrEuOpen && now.getMinutes() !== 0) {
      console.log('[Scheduler] All markets closed - skipping 5min cycle');
      return;
    }

    const mode = nasdaq.isOpen
      ? 'normal (US market open)'
      : isEuropeanMarketOpen(now)
        ? 'normal (EU market open)'
        : 'closed-market hourly check';
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

  console.log('[Scheduler] Initialized - 5min market cycles; EU + US market hours supported');

  setTimeout(async () => {
    const nasdaq = getNasdaqStatus();
    const now = new Date();
    const usOrEuOpen = nasdaq.isOpen || isEuropeanMarketOpen(now);

    if (!usOrEuOpen) {
      console.log('[Scheduler] Initial cycle skipped - all markets closed');
      return;
    }

    console.log(`[Scheduler] Running initial cycle on startup`);
    try {
      await addCycleJob();
    } catch (err) {
      console.error('[Scheduler] Initial cycle failed:', err);
    }
  }, 5000);
}

function isEuropeanMarketOpen(now: Date): boolean {
  const cetOffset = getCETOffsetMs(now);
  const cetMs = now.getTime() + cetOffset;
  const cetDate = new Date(cetMs);
  const day = cetDate.getUTCDay();
  const h = cetDate.getUTCHours();
  const m = cetDate.getUTCMinutes();
  const time = h * 60 + m;
  const isWeekday = day >= 1 && day <= 5;
  return isWeekday && time >= 510 && time < 1050; // 8:30-17:30 CET
}

function getCETOffsetMs(date: Date): number {
  const year = date.getUTCFullYear();
  const marchDow = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const dstStart = Date.UTC(year, 2, 8 + ((7 - marchDow) % 7), 1);
  const octDow = new Date(Date.UTC(year, 9, 1)).getUTCDay();
  const dstEnd = Date.UTC(year, 9, 1 + ((7 - octDow) % 7), 1);
  const isDST = date.getTime() >= dstStart && date.getTime() < dstEnd;
  return isDST ? 2 * 3600000 : 1 * 3600000;
}