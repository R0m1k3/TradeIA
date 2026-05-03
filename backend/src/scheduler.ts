import cron from 'node-cron';
import { addCycleJob } from './queue';
import { getNasdaqStatus } from './routes/market';

export function initScheduler() {
  // Main trading cycle every 5 minutes — only when NASDAQ is open
  // During pre-market (8:00-9:30 ET) and market hours (9:30-16:00 ET)
  // Skip entirely on weekends and after-hours to save LLM credits
  cron.schedule('*/5 * * * *', async () => {
    const nasdaq = getNasdaqStatus();
    if (!nasdaq.isOpen) {
      // Log once per hour when market is closed (not every 5min)
      const now = new Date();
      if (now.getMinutes() < 5) {
        console.log(`[Scheduler] Market closed — ${nasdaq.nextOpen || 'weekend'}. Skipping cycle.`);
      }
      return;
    }
    console.log('[Scheduler] Triggering trading cycle');
    try {
      await addCycleJob();
    } catch (err) {
      console.error('[Scheduler] Failed to enqueue cycle job:', err);
    }
  });

  // Heartbeat every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    console.log('[Scheduler] Heartbeat ✓', new Date().toISOString());
  });

  console.log('[Scheduler] Initialized — trading cycle every 5min (market hours only), heartbeat every 15min');

  // Trigger first cycle on startup (only if market is open)
  setTimeout(async () => {
    const nasdaq = getNasdaqStatus();
    if (nasdaq.isOpen) {
      console.log('[Scheduler] Running initial cycle on startup');
      try {
        await addCycleJob();
      } catch (err) {
        console.error('[Scheduler] Initial cycle failed:', err);
      }
    } else {
      console.log(`[Scheduler] Market closed on startup — ${nasdaq.nextOpen || 'weekend'}. First cycle will run at market open.`);
    }
  }, 5000);
}
