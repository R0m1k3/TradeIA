import { cacheGet, cacheSet, TTL } from './cache';
import { getYahooOHLCV } from './yahoo';

export interface MarketInternals {
  indexes: Record<string, { change_1d_pct: number | null; change_5d_pct: number | null; trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' }>;
  sector_momentum: Record<string, number | null>;
  risk_on_score: number;
  risk_regime: 'RISK_ON' | 'RISK_OFF' | 'MIXED';
  notes: string[];
}

const INDEX_TICKERS = ['SPY', 'QQQ', 'IWM', 'DIA', 'TLT', 'UUP', 'HYG', 'LQD'];
const SECTOR_ETFS: Record<string, string> = {
  Technology: 'XLK',
  Communication: 'XLC',
  ConsumerCyclical: 'XLY',
  ConsumerDefensive: 'XLP',
  Financials: 'XLF',
  Healthcare: 'XLV',
  Industrials: 'XLI',
  Energy: 'XLE',
  Utilities: 'XLU',
  RealEstate: 'XLRE',
};

function pctChange(values: number[], lookback: number): number | null {
  if (values.length <= lookback) return null;
  const last = values[values.length - 1];
  const prev = values[values.length - 1 - lookback];
  if (!last || !prev) return null;
  return Math.round(((last - prev) / prev) * 10000) / 100;
}

async function dailyReturns(ticker: string): Promise<{ change_1d_pct: number | null; change_5d_pct: number | null }> {
  const bars = await getYahooOHLCV(ticker, '1d', '1mo');
  const closes = bars.map((b) => b.close).filter((v) => Number.isFinite(v));
  return {
    change_1d_pct: pctChange(closes, 1),
    change_5d_pct: pctChange(closes, 5),
  };
}

export async function getMarketInternals(): Promise<MarketInternals> {
  const cached = await cacheGet<MarketInternals>('market:internals');
  if (cached) return cached;

  try {
    const indexEntries = await Promise.all(
      INDEX_TICKERS.map(async (ticker) => {
        const changes = await dailyReturns(ticker);
        const trend = (changes.change_5d_pct ?? 0) > 1 ? 'BULLISH' : (changes.change_5d_pct ?? 0) < -1 ? 'BEARISH' : 'NEUTRAL';
        return [ticker, { ...changes, trend }] as const;
      })
    );

    const sectorEntries = await Promise.all(
      Object.entries(SECTOR_ETFS).map(async ([sector, ticker]) => {
        const changes = await dailyReturns(ticker);
        return [sector, changes.change_5d_pct] as const;
      })
    );

    const indexes = Object.fromEntries(indexEntries);
    const sector_momentum = Object.fromEntries(sectorEntries);
    const spy = indexes.SPY?.change_5d_pct ?? 0;
    const qqq = indexes.QQQ?.change_5d_pct ?? 0;
    const iwm = indexes.IWM?.change_5d_pct ?? 0;
    const hyg = indexes.HYG?.change_5d_pct ?? 0;
    const tlt = indexes.TLT?.change_5d_pct ?? 0;
    const uup = indexes.UUP?.change_5d_pct ?? 0;
    const riskOnScore = Math.round((spy + qqq + iwm + hyg - Math.max(uup, 0) - Math.max(tlt, 0)) * 10) / 10;

    const notes: string[] = [];
    if (qqq > spy + 1) notes.push('Nasdaq leadership vs S&P 500');
    if (iwm < spy - 1) notes.push('Small caps lagging large caps');
    if (hyg < -1) notes.push('High yield credit weakening');
    if (uup > 1) notes.push('Dollar strength can pressure risk assets');

    const result: MarketInternals = {
      indexes,
      sector_momentum,
      risk_on_score: riskOnScore,
      risk_regime: riskOnScore > 2 ? 'RISK_ON' : riskOnScore < -2 ? 'RISK_OFF' : 'MIXED',
      notes,
    };

    await cacheSet('market:internals', result, TTL.MARKET_CONTEXT);
    return result;
  } catch (err) {
    console.warn('[MarketInternals] failed:', (err as Error).message);
    return { indexes: {}, sector_momentum: {}, risk_on_score: 0, risk_regime: 'MIXED', notes: [] };
  }
}
