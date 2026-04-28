import cron from 'node-cron';
import { addCycleJob } from './queue';

export function initScheduler() {
  // Main trading cycle every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
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

  console.log('[Scheduler] Initialized — trading cycle every 5min, heartbeat every 15min');

  // Trigger first cycle immediately on startup
  setTimeout(async () => {
    console.log('[Scheduler] Running initial cycle on startup');
    try {
      await addCycleJob();
    } catch (err) {
      console.error('[Scheduler] Initial cycle failed:', err);
    }
  }, 5000);
}
