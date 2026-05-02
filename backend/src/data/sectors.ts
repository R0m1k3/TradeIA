import { getYahooOHLCV } from './yahoo';
import { cacheGet, cacheSet, TTL } from './cache';

/** Mapping NASDAQ 100 tickers → secteur */
export const TICKER_SECTOR: Record<string, string> = {
  // Technology
  AAPL: 'Tech', MSFT: 'Tech', NVDA: 'Tech', AVGO: 'Tech', ORCL: 'Tech',
  ADBE: 'Tech', CRM: 'Tech', INTC: 'Tech', AMD: 'Tech', QCOM: 'Tech',
  TXN: 'Tech', LRCX: 'Tech', KLAC: 'Tech', MRVL: 'Tech', SNPS: 'Tech',
  CDNS: 'Tech', ARM: 'Tech',
  // Communication / Internet
  GOOGL: 'Comms', META: 'Comms', NFLX: 'Comms', CMCSA: 'Comms', CHTR: 'Comms',
  // Consumer / E-commerce
  AMZN: 'ConsDisc', TSLA: 'ConsDisc', BKNG: 'ConsDisc', ABNB: 'ConsDisc', SBUX: 'ConsDisc',
  // Fintech / Financial
  PYPL: 'Fintech', COIN: 'Fintech',
  // Healthcare / Biotech
  ISRG: 'Health', GILD: 'Health', VRTX: 'Health', REGN: 'Health',
  MRNA: 'Health', ILMN: 'Health', BIIB: 'Health', MDLZ: 'Health',
  // Enterprise / SaaS / Cybersec
  ADP: 'Enterprise', FTNT: 'Cyber', ZS: 'Cyber', DDOG: 'Cyber',
  NET: 'Cyber', CRWD: 'Cyber', PANW: 'Cyber',
  // AI / Analytics
  PLTR: 'AI', MNST: 'ConsStap',
  // Consumer Staples
  PEP: 'ConsStap', COST: 'ConsStap',
  // Industrials
  GE: 'Industrial',
};

export function getTickerSector(ticker: string): string {
  return TICKER_SECTOR[ticker] || 'Autre';
}

/** Secteur ETF → direction marché */
const SECTOR_ETFS: Record<string, string> = {
  Tech: 'XLK',
  Health: 'XLV',
  Fintech: 'XLF',
  ConsDisc: 'XLY',
  ConsStap: 'XLP',
  Energy: 'XLE',
  Industrial: 'XLI',
  Comms: 'XLC',
};

export interface SectorBias {
  sector: string;
  etf: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  change_pct: number;
}

export async function getSectorBiases(): Promise<Record<string, SectorBias>> {
  const cacheKey = 'sectors:biases';
  const cached = await cacheGet<Record<string, SectorBias>>(cacheKey);
  if (cached) return cached;

  const biases: Record<string, SectorBias> = {};

  await Promise.all(
    Object.entries(SECTOR_ETFS).map(async ([sector, etf]) => {
      try {
        const bars = await getYahooOHLCV(etf, '1d', '5d');
        if (bars.length >= 2) {
          const today = bars[bars.length - 1].close;
          const yesterday = bars[bars.length - 2].close;
          const change = ((today - yesterday) / yesterday) * 100;
          biases[sector] = {
            sector,
            etf,
            direction: change > 0.5 ? 'bullish' : change < -0.5 ? 'bearish' : 'neutral',
            change_pct: Math.round(change * 100) / 100,
          };
        } else {
          biases[sector] = { sector, etf, direction: 'neutral', change_pct: 0 };
        }
      } catch {
        biases[sector] = { sector, etf, direction: 'neutral', change_pct: 0 };
      }
    })
  );

  await cacheSet(cacheKey, biases, TTL.SECTOR);
  return biases;
}

/** Compter positions ouvertes par secteur */
export function countPositionsBySector(
  positions: { ticker: string }[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of positions) {
    const sector = getTickerSector(p.ticker);
    counts[sector] = (counts[sector] || 0) + 1;
  }
  return counts;
}
