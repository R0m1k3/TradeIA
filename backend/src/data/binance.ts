import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';

export interface CryptoOHLCV {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CryptoTicker24h {
  change_pct_24h: number | null;
  quote_volume_24h: number | null;
  high_24h: number | null;
  low_24h: number | null;
  range_pct_24h: number | null;
  trades_24h: number | null;
}

const BASE = 'https://api.binance.com/api/v3';

export async function getBinanceOHLCV(ticker: string, interval: '15m' | '1h' | '4h' | '1d'): Promise<CryptoOHLCV[]> {
  const cacheKey = `binance:ohlcv:${ticker}:${interval}`;
  const cached = await cacheGet<CryptoOHLCV[]>(cacheKey);
  if (cached) return cached;

  try {
    // Binance intervals: 15m, 1h, 4h, 1d
    const symbol = `${ticker}USDT`;
    const response = await axios.get(`${BASE}/klines`, {
      params: {
        symbol,
        interval,
        limit: 200,
      },
      timeout: 10_000,
    });

    const bars: CryptoOHLCV[] = response.data.map((k: any) => ({
      time: new Date(k[0]).toISOString(),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    await cacheSet(cacheKey, bars, interval === '15m' ? TTL.OHLCV : TTL.FUNDAMENTALS);
    return bars;
  } catch (err) {
    console.warn(`[Binance] Failed to get OHLCV for ${ticker}:`, (err as Error).message);
    return [];
  }
}

export async function getBinanceCurrentPrice(ticker: string): Promise<number | null> {
  const cacheKey = `binance:price:${ticker}`;
  const cached = await cacheGet<number>(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(`${BASE}/ticker/price`, {
      params: { symbol: `${ticker}USDT` },
      timeout: 5_000,
    });
    const price = parseFloat(response.data.price);
    if (price) {
      await cacheSet(cacheKey, price, TTL.PRICE);
      return price;
    }
    return null;
  } catch (err) {
    console.warn(`[Binance] Failed to get price for ${ticker}:`, (err as Error).message);
    return null;
  }
}

export async function getBinanceTicker24h(ticker: string): Promise<CryptoTicker24h> {
  const cacheKey = `binance:24h:${ticker}`;
  const cached = await cacheGet<CryptoTicker24h>(cacheKey);
  if (cached) return cached;

  const empty: CryptoTicker24h = {
    change_pct_24h: null,
    quote_volume_24h: null,
    high_24h: null,
    low_24h: null,
    range_pct_24h: null,
    trades_24h: null,
  };

  try {
    const response = await axios.get(`${BASE}/ticker/24hr`, {
      params: { symbol: `${ticker}USDT` },
      timeout: 5_000,
      validateStatus: () => true,
    });
    if (response.status !== 200) return empty;

    const high = parseFloat(response.data.highPrice);
    const low = parseFloat(response.data.lowPrice);
    const last = parseFloat(response.data.lastPrice);
    const rangePct = high > 0 && low > 0 && last > 0 ? ((high - low) / last) * 100 : null;
    const result: CryptoTicker24h = {
      change_pct_24h: parseFloat(response.data.priceChangePercent) || null,
      quote_volume_24h: parseFloat(response.data.quoteVolume) || null,
      high_24h: high || null,
      low_24h: low || null,
      range_pct_24h: rangePct !== null ? Math.round(rangePct * 100) / 100 : null,
      trades_24h: parseInt(response.data.count, 10) || null,
    };

    await cacheSet(cacheKey, result, TTL.MARKET_CONTEXT);
    return result;
  } catch (err) {
    console.warn(`[Binance] Failed to get 24h metrics for ${ticker}:`, (err as Error).message);
    return empty;
  }
}
