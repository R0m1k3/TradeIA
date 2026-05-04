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
