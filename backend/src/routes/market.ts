import { FastifyPluginAsync } from 'fastify';
import { getMarketContext } from '../data/finnhub';
import { getYahooOHLCV } from '../data/yahoo';
import { getDaily } from '../data/alphavantage';
import { getCredential } from '../config/credentials';

export function getNasdaqStatus(): { isOpen: boolean; nextOpen: string; nextClose: string } {
  const now = new Date();
  // Convert UTC to ET using offset (no Intl dependency — works in Alpine Docker)
  const utcMs = now.getTime();
  const etOffsetMs = getETOffsetMs(now);
  const etMs = utcMs + etOffsetMs;
  const etDate = new Date(etMs);

  const day = etDate.getUTCDay();
  const h = etDate.getUTCHours();
  const m = etDate.getUTCMinutes();
  const time = h * 60 + m;

  const isWeekday = day >= 1 && day <= 5;
  const isMarketHours = isWeekday && time >= 570 && time < 960; // 9:30-16:00 ET

  let nextOpen: string;
  let nextClose: string;

  if (isMarketHours) {
    nextOpen = '';
    nextClose = "Clôture à 16h00 HE";
  } else {
    const minutesToOpen = (() => {
      if (!isWeekday) {
        // Weekend: days until Monday
        const daysToMonday = day === 0 ? 1 : day === 6 ? 2 : 0;
        return daysToMonday * 24 * 60 + (570 - time);
      }
      if (time < 570) return 570 - time; // Before open today
      return (24 * 60 - time) + 570 + (day === 5 ? 2 * 24 * 60 : 0); // After close, or Friday
    })();
    const hours = Math.floor(minutesToOpen / 60);
    const mins = minutesToOpen % 60;
    nextOpen = hours > 0 ? `Ouvre dans ${hours}h${mins > 0 ? ` ${mins}min` : ''}` : `Ouvre dans ${mins}min`;
    nextClose = '';
  }

  return { isOpen: isMarketHours, nextOpen, nextClose };
}

/** Calculate ET offset in ms, accounting for DST (US rules: 2nd Sunday March - 1st Sunday November) */
function getETOffsetMs(date: Date): number {
  const year = date.getUTCFullYear();
  // 2nd Sunday of March
  const marchDow = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const dstStart = Date.UTC(year, 2, 8 + ((7 - marchDow) % 7), 2); // 2am ET = 7am UTC spring forward
  // 1st Sunday of November
  const novDow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - novDow) % 7), 2); // 2am ET = 6am UTC fall back
  const isDST = date.getTime() >= dstStart && date.getTime() < dstEnd;
  return isDST ? -4 * 3600000 : -5 * 3600000;
}

const marketRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/context', async () => {
    const context = await getMarketContext();
    const nasdaq = getNasdaqStatus();
    return {
      vix: context.vix,
      fear_greed: context.fear_greed,
      nasdaq: context.nasdaq_direction,
      nasdaq_change_pct: context.nasdaq_change_pct,
      nasdaq_status: nasdaq,
    };
  });

  fastify.get('/ohlcv/:ticker', async (req) => {
    const { ticker } = req.params as { ticker: string };
    const query = req.query as { interval?: string };
    const interval = (query.interval || '1d') as '15m' | '1h' | '4h' | '1d';

    // Try Yahoo first (free, no key needed), then AlphaVantage as fallback
    const yahooBars = await getYahooOHLCV(ticker, interval === '15m' ? '15m' : interval === '1h' ? '1h' : interval === '4h' ? '4h' : '1d');
    if (yahooBars.length > 0) return yahooBars;

    // Fallback to AlphaVantage daily
    if (interval === '1d') {
      const avKey = await getCredential('alpha_vantage_key', 'ALPHA_VANTAGE_KEY') || await getCredential('alpha_vantage_key', 'ALPHAVANTAGE_KEY');
      if (avKey) {
        const avBars = await getDaily(ticker);
        if (avBars.length > 0) return avBars;
      }
    }

    return [];
  });
};

export default marketRoutes;