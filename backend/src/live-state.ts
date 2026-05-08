import { getCredential } from './config/credentials';
import { getPortfolioState } from './broker/mock';
import { getMarketContext } from './data/yahoo';
import { getEUIndexDirection, getEUMarketStatus } from './data/european-markets';
import { getNasdaqStatus } from './routes/market';
import { broadcastCycleUpdate, CycleUpdatePayload, getWebSocketClientCount, setOnWebSocketClientConnected } from './websocket';

const LIVE_STATE_INTERVAL_MS = parseInt(process.env.LIVE_STATE_INTERVAL_MS || '30000', 10);
let interval: ReturnType<typeof setInterval> | null = null;
let snapshotInFlight = false;

export async function buildLiveStateSnapshot(): Promise<CycleUpdatePayload> {
  const portfolioUsdRaw = await getCredential('portfolio_usd', 'PORTFOLIO_USD');
  const portfolioUsd = parseFloat(portfolioUsdRaw || '10000');
  const context = await getMarketContext();
  const euData = await getEUIndexDirection().catch(() => ({ cac40_change_pct: 0, dax_change_pct: 0, ftse100_change_pct: 0, eu_market_open: false }));
  const euStatus = getEUMarketStatus();

  // Live-state only broadcasts fields it can compute without a full cycle.
  // sector_biases, macro, data_freshness are authoritative from the cycle reporter — omit
  // them here so they are never null-merged over real cycle data in the frontend store.
  return {
    portfolio: await getPortfolioState(Number.isFinite(portfolioUsd) ? portfolioUsd : 10000),
    market: {
      vix: context.vix,
      fear_greed: context.fear_greed,
      nasdaq: context.nasdaq_direction,
      nasdaq_change_pct: context.nasdaq_change_pct,
      nasdaq_status: getNasdaqStatus(),
      eu: euData,
      eu_status: euStatus,
    } as CycleUpdatePayload['market'],
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