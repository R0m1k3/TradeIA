import { FastifyPluginAsync } from 'fastify';
import { getEquityOHLCV, getMarketContext, getTickerSnapshots, getYahooVIX } from '../data/yahoo';
import { getCredential } from '../config/credentials';
import { sourceFreshness, summarizeFreshness } from '../data/freshness';
import { getEUIndexDirection, getEUMarketStatus } from '../data/european-markets';
import { NASDAQ_100, DAX_40, CAC_40, FTSE_100, EU_OTHER } from '../agents/discovery';
import { classifyRegime } from '../agents/regime';
import { isMacroBlackout, nextMacroEvent } from '../data/macro-events';

/**
 * Segment → ticker list resolver.
 * Defined as a function (not module-level const) to avoid circular-import races
 * between routes/market.ts ↔ agents/discovery.ts where the imported lists could
 * be `undefined` at module-init time.
 */
function getSegmentTickers(segment: string): string[] | null {
  switch (segment) {
    case 'nasdaq': return NASDAQ_100;
    case 'dax40': return DAX_40;
    case 'cac40': return CAC_40;
    case 'ftse100': return FTSE_100;
    case 'eu_other': return EU_OTHER;
    default: return null;
  }
}

export function getNasdaqStatus(): { isOpen: boolean; nextOpen: string; nextClose: string } {
  const now = new Date();
  const utcMs = now.getTime();
  const etOffsetMs = getETOffsetMs(now);
  const etMs = utcMs + etOffsetMs;
  const etDate = new Date(etMs);

  const day = etDate.getUTCDay();
  const h = etDate.getUTCHours();
  const m = etDate.getUTCMinutes();
  const time = h * 60 + m;

  const isWeekday = day >= 1 && day <= 5;
  const isMarketHours = isWeekday && time >= 570 && time < 960;

  let nextOpen: string;
  let nextClose: string;

  if (isMarketHours) {
    nextOpen = '';
    nextClose = "Clôture à 16h00 HE";
  } else {
    const minutesToOpen = (() => {
      if (!isWeekday) {
        const daysToMonday = day === 0 ? 1 : day === 6 ? 2 : 0;
        return daysToMonday * 24 * 60 + (570 - time);
      }
      if (time < 570) return 570 - time;
      return (24 * 60 - time) + 570 + (day === 5 ? 2 * 24 * 60 : 0);
    })();
    const hours = Math.floor(minutesToOpen / 60);
    const mins = minutesToOpen % 60;
    nextOpen = hours > 0 ? `Ouvre dans ${hours}h${mins > 0 ? ` ${mins}min` : ''}` : `Ouvre dans ${mins}min`;
    nextClose = '';
  }

  return { isOpen: isMarketHours, nextOpen, nextClose };
}

function getETOffsetMs(date: Date): number {
  const year = date.getUTCFullYear();
  const marchDow = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const dstStart = Date.UTC(year, 2, 8 + ((7 - marchDow) % 7), 2);
  const novDow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - novDow) % 7), 2);
  const isDST = date.getTime() >= dstStart && date.getTime() < dstEnd;
  return isDST ? -4 * 3600000 : -5 * 3600000;
}

const marketRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/context', async () => {
    const context = await getMarketContext();
    const nasdaq = getNasdaqStatus();
    const eu = await getEUIndexDirection();
    const euStatus = getEUMarketStatus();
    const polygonKey = await getCredential('polygon_key', 'POLYGON_KEY');
    const eodhdKey = await getCredential('eodhd_key', 'EODHD_KEY');
    return {
      vix: context.vix,
      fear_greed: context.fear_greed,
      nasdaq: context.nasdaq_direction,
      nasdaq_change_pct: context.nasdaq_change_pct,
      nasdaq_status: nasdaq,
      eu,
      eu_status: euStatus,
      data_freshness: summarizeFreshness([
        sourceFreshness('Yahoo Finance', context.vix > 0 ? 'delayed' : 'missing', 'Contexte actions gratuit, pas garanti temps réel.'),
        sourceFreshness('Polygon.io', polygonKey ? 'limited' : 'missing', polygonKey ? 'Clé FREE configurée, source limitée/différée.' : 'Clé absente.'),
        sourceFreshness('Indices EU', eu.cac40_change_pct !== 0 || eu.dax_change_pct !== 0 ? 'fresh' : 'limited', 'CAC 40, DAX, FTSE 100 via Twelve Data / Yahoo.'),
        sourceFreshness('EODHD', eodhdKey ? 'fresh' : 'missing', eodhdKey ? 'Clé configurée pour données européennes.' : 'Clé absente.'),
      ], [
        'Les actions gratuites peuvent être retardées; les indices EU sont mis à jour via Twelve Data.',
      ]),
    };
  });

  fastify.get('/ohlcv/:ticker', async (req) => {
    const { ticker } = req.params as { ticker: string };
    const query = req.query as { interval?: string };
    const interval = (query.interval || '1d') as '15m' | '1h' | '4h' | '1d';

    const equityBars = await getEquityOHLCV(ticker, interval);
    return equityBars.length > 0 ? equityBars : [];
  });

  fastify.get('/snapshot/:segment', async (req) => {
    const { segment } = req.params as { segment: string };
    const tickers = getSegmentTickers(segment);
    if (!tickers) {
      return { error: `Unknown segment: ${segment}` };
    }
    const snapshots = await getTickerSnapshots(tickers);
    return snapshots;
  });

  fastify.get('/regime', async () => {
    const vix = await getYahooVIX() ?? 20;
    const regime = await classifyRegime(vix);
    const blackout = isMacroBlackout();
    const next = nextMacroEvent();
    return {
      regime: regime.regime,
      confidence: regime.confidence,
      reason: regime.reason,
      sizing_multiplier: regime.sizing_multiplier,
      prefer_momentum: regime.prefer_momentum,
      inputs: regime.inputs,
      macro_blackout: blackout,
      next_macro_event: next,
    };
  });
};

export default marketRoutes;