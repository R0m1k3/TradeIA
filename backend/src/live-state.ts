import { getCredential } from './config/credentials';
import { getPortfolioState } from './broker/mock';
import { getMarketContext } from './data/yahoo';
import { getEUIndexDirection, getEUMarketStatus } from './data/european-markets';
import { sourceFreshness, summarizeFreshness } from './data/freshness';
import { getNasdaqStatus } from './routes/market';
import { broadcastCycleUpdate, CycleUpdatePayload, getWebSocketClientCount, setOnWebSocketClientConnected } from './websocket';

const LIVE_STATE_INTERVAL_MS = parseInt(process.env.LIVE_STATE_INTERVAL_MS || '30000', 10);
let interval: ReturnType<typeof setInterval> | null = null;
let snapshotInFlight = false;

export async function buildLiveStateSnapshot(): Promise<CycleUpdatePayload> {
  const portfolioUsdRaw = await getCredential('portfolio_usd', 'PORTFOLIO_USD');
  const portfolioUsd = parseFloat(portfolioUsdRaw || '10000');
  const context = await getMarketContext();
  const enrichedContext = context as typeof context & { macro?: unknown; sector_biases?: unknown };
  const euData = await getEUIndexDirection().catch(() => ({ cac40_change_pct: 0, dax_change_pct: 0, ftse100_change_pct: 0, eu_market_open: false }));
  const euStatus = getEUMarketStatus();
  const polygonKey = await getCredential('polygon_key', 'POLYGON_KEY');
  const eodhdKey = await getCredential('eodhd_key', 'EODHD_KEY');

  return {
    portfolio: await getPortfolioState(Number.isFinite(portfolioUsd) ? portfolioUsd : 10000),
    market: {
      vix: context.vix,
      fear_greed: context.fear_greed,
      nasdaq: context.nasdaq_direction,
      nasdaq_change_pct: context.nasdaq_change_pct,
      nasdaq_status: getNasdaqStatus(),
      macro: enrichedContext.macro || null,
      sector_biases: enrichedContext.sector_biases || null,
      eu: euData,
      eu_status: euStatus,
      data_freshness: summarizeFreshness([
        sourceFreshness('Yahoo Finance', context.vix > 0 ? 'delayed' : 'missing', 'Contexte actions gratuit, pas garanti temps réel.'),
        sourceFreshness('Polygon.io', polygonKey ? 'limited' : 'missing', polygonKey ? 'Clé FREE configurée, source limitée/différée.' : 'Clé absente.'),
        sourceFreshness('Indices EU', euData.cac40_change_pct !== 0 || euData.dax_change_pct !== 0 ? 'fresh' : 'limited', 'CAC 40, DAX, FTSE 100 via Twelve Data / Yahoo.'),
        sourceFreshness('EODHD', eodhdKey ? 'fresh' : 'missing', eodhdKey ? 'Clé configurée pour données européennes.' : 'Clé absente.'),
      ], [
        'Snapshot live via WebSocket; les actions gratuites peuvent rester différées.',
      ]),
    } as CycleUpdatePayload['market'] & Record<string, unknown>,
  };
}

export async function broadcastLiveStateSnapshot(): Promise<void> {
  if (getWebSocketClientCount() === 0) return;
  if (snapshotInFlight) return;
  snapshotInFlight = true;

  try {
    broadcastCycleUpdate(await buildLiveStateSnapshot());
  } catch (err) {
    console.error('[LiveState] Snapshot failed:', err);
  } finally {
    snapshotInFlight = false;
  }
}

export function startLiveStateStream(): void {
  if (interval) return;

  setOnWebSocketClientConnected(() => {
    void broadcastLiveStateSnapshot();
  });

  interval = setInterval(() => {
    void broadcastLiveStateSnapshot();
  }, Math.max(5000, LIVE_STATE_INTERVAL_MS));

  console.log(`[LiveState] WebSocket snapshots every ${Math.max(5000, LIVE_STATE_INTERVAL_MS)}ms`);
}