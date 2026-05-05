import cron from 'node-cron';
import { addCycleJob } from './queue';
import { getNasdaqStatus } from './routes/market';

export function initScheduler() {
  // Trading cycle every 5 minutes — always active (crypto trades 24/7)
  // Discovery automatically switches to crypto-only when NASDAQ is closed
  cron.schedule('*/5 * * * *', async () => {
    const nasdaq = getNasdaqStatus();
    const mode = nasdaq.isOpen ? 'full (stocks + crypto)' : 'crypto-only';
    console.log(`[Scheduler] Triggering trading cycle — mode: ${mode}`);
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

  console.log('[Scheduler] Initialized — trading cycle every 5min 24/7 (crypto-only when market closed)');

  // Trigger first cycle on startup immediately
  setTimeout(async () => {
    const nasdaq = getNasdaqStatus();
    const mode = nasdaq.isOpen ? 'full (stocks + crypto)' : 'crypto-only';
    console.log(`[Scheduler] Running initial cycle on startup — mode: ${mode}`);
    try {
      await addCycleJob();
    } catch (err) {
      console.error('[Scheduler] Initial cycle failed:', err);
    }
  }, 5000);
}
