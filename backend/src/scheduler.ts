import cron from 'node-cron';
import { addCycleJob } from './queue';
import { getNasdaqStatus } from './routes/market';

export function initScheduler() {
  // LITE cycle every 5 min during market hours: mark-to-market only (trailing stops + SL/TP).
  // No LLM cost.
  cron.schedule('*/5 * * * *', async () => {
    const nasdaq = getNasdaqStatus();
    const now = new Date();
    const usOrEuOpen = nasdaq.isOpen || isEuropeanMarketOpen(now);
    if (!usOrEuOpen) return;
    try {
      await addCycleJob('lite');
    } catch (err) {
      console.error('[Scheduler] Lite cycle enqueue failed:', err);
    }
  });

  // FULL pipeline 4× par jour de semaine sur horaires fixes alignés sur swing trading (5–20j).
  // Évite la sur-réaction au bruit intra-day et réduit le coût LLM de ~95%.
  // Horaires UTC : 08h (EU mid-morning), 13h (US pre-open), 15h (US mid-session), 19h (US afternoon).
  cron.schedule('0 8,13,15,19 * * 1-5', async () => {
    const nasdaq = getNasdaqStatus();
    const now = new Date();
    const euOpen = isEuropeanMarketOpen(now);
    const usOrEuOpen = nasdaq.isOpen || euOpen;

    console.log(`[Scheduler] Full cron tick — utc=${now.toISOString()} nasdaq=${nasdaq.isOpen} eu=${euOpen} usOrEuOpen=${usOrEuOpen}`);

    if (!usOrEuOpen) {
      console.log('[Scheduler] Full cycle skipped — all markets closed');
      return;
    }

    const mode = nasdaq.isOpen
      ? 'US market open'
      : 'EU market open';
    console.log(`[Scheduler] Triggering FULL trading cycle - ${mode}`);
    try {
      await addCycleJob('full');
    } catch (err) {
      console.error('[Scheduler] Full cycle enqueue failed:', err);
    }
  });

  cron.schedule('*/15 * * * *', () => {
    console.log('[Scheduler] Heartbeat', new Date().toISOString());
  });


  // Pre-market prep: 8:30 CET weekdays — only when markets closed
  cron.schedule('30 8 * * 1-5', async () => {
    const nasdaq = getNasdaqStatus();
    const now = new Date();
    if (nasdaq.isOpen || isEuropeanMarketOpen(now)) {
      console.log('[Scheduler] Pre-market skipped — markets already open');
      return;
    }
    console.log('[Scheduler] Triggering PRE-MARKET prep');
    try {
      await addCycleJob('pre_market');
    } catch (err) {
      console.error('[Scheduler] Pre-market enqueue failed:', err);
    }
  });

  setTimeout(async () => {
    const nasdaq = getNasdaqStatus();
    const now = new Date();
    const usOrEuOpen = nasdaq.isOpen || isEuropeanMarketOpen(now);
    if (!usOrEuOpen) {
      console.log('[Scheduler] Initial cycle skipped - all markets closed');
      return;
    }
    console.log('[Scheduler] Running initial FULL cycle on startup');
    try {
      await addCycleJob('full');
    } catch (err) {
      console.error('[Scheduler] Initial cycle failed:', err);
    }
  }, 5000);

  console.log('[Scheduler] Initialized — lite=5min, full=4×/day (08/13/15/19 UTC), pre_market=8h30 CET');
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