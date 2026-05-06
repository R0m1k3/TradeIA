import { FastifyPluginAsync } from 'fastify';
import { getEquityOHLCV, getMarketContext } from '../data/yahoo';
import { getBinanceOHLCV } from '../data/binance';
import { getCryptoContext } from '../data/crypto-context';
import { getCredential } from '../config/credentials';
import { sourceFreshness, summarizeFreshness } from '../data/freshness';

const CRYPTO_TICKERS = new Set([
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'SHIB', 'DOT',
  'LINK', 'TRX', 'MATIC', 'BCH', 'LTC', 'NEAR', 'UNI', 'APT', 'INJ', 'RENDER',
]);

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
    const polygonKey = await getCredential('polygon_key', 'POLYGON_KEY');
    return {
      vix: context.vix,
      fear_greed: context.fear_greed,
      nasdaq: context.nasdaq_direction,
      nasdaq_change_pct: context.nasdaq_change_pct,
      nasdaq_status: nasdaq,
      data_freshness: summarizeFreshness([
        sourceFreshness('Yahoo Finance', context.vix > 0 ? 'delayed' : 'missing', 'Contexte actions gratuit, pas garanti temps réel.'),
        sourceFreshness('Polygon.io', polygonKey ? 'limited' : 'missing', polygonKey ? 'Clé FREE configurée, source limitée/différée.' : 'Clé absente.'),
        sourceFreshness('Binance Spot', 'live', 'Crypto disponible 24/7 via Binance.'),
      ], [
        'Les actions gratuites peuvent être retardées; les cryptos sont les plus fraîches.',
      ]),
    };
  });

  fastify.get('/ohlcv/:ticker', async (req) => {
    const { ticker } = req.params as { ticker: string };
    const query = req.query as { interval?: string };
    const interval = (query.interval || '1d') as '15m' | '1h' | '4h' | '1d';

    if (CRYPTO_TICKERS.has(ticker.toUpperCase())) {
      const bars = await getBinanceOHLCV(ticker.toUpperCase(), interval === '4h' ? '4h' : interval === '1h' ? '1h' : interval === '15m' ? '15m' : '1d');
      return bars.length > 0 ? bars : [];
    }

    const equityBars = await getEquityOHLCV(ticker, interval);
    return equityBars.length > 0 ? equityBars : [];
  });

  fastify.get('/crypto-context', async () => {
    return getCryptoContext();
  });
};

export default marketRoutes;
