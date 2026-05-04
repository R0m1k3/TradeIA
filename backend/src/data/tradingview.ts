import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';

export interface TradingViewSignal {
  recommendation: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL' | 'UNKNOWN';
  score: number; // -1 to 1
}

function parseScore(score: number): TradingViewSignal['recommendation'] {
  if (score >= 0.5) return 'STRONG_BUY';
  if (score >= 0.1) return 'BUY';
  if (score <= -0.5) return 'STRONG_SELL';
  if (score <= -0.1) return 'SELL';
  return 'NEUTRAL';
}

export async function getTradingViewSignal(ticker: string, isCrypto = false): Promise<TradingViewSignal> {
  const cacheKey = `tv:signal:${ticker}`;
  const cached = await cacheGet<TradingViewSignal>(cacheKey);
  if (cached) return cached;

  try {
    const market = isCrypto ? 'crypto' : 'america';
    const exchange = isCrypto ? 'BINANCE' : 'NASDAQ'; // Simplification for scan
    const symbol = isCrypto ? `${ticker}USDT` : ticker;

    const response = await axios.post(
      `https://scanner.tradingview.com/${market}/scan`,
      {
        symbols: { tickers: [`${exchange}:${symbol}`, `NYSE:${symbol}`] },
        columns: ['Recommend.All'],
      },
      { timeout: 10_000 }
    );

    const data = response.data?.data;
    if (data && data.length > 0) {
      const score = data[0].d[0];
      if (typeof score === 'number') {
        const result: TradingViewSignal = {
          recommendation: parseScore(score),
          score,
        };
        await cacheSet(cacheKey, result, TTL.MARKET_CONTEXT);
        return result;
      }
    }
    return { recommendation: 'UNKNOWN', score: 0 };
  } catch (err) {
    console.warn(`[TradingView] Failed to get signal for ${ticker}:`, (err as Error).message);
    return { recommendation: 'UNKNOWN', score: 0 };
  }
}
