import axios from 'axios';
import { getCredential } from '../config/credentials';
import { cacheGet, cacheSet, TTL } from './cache';
import type { OHLCVBar } from './indicators';

const BASE_URL = 'https://api.twelvedata.com';

/**
 * Daily credit-exhaustion circuit breaker.
 * Once we see "ran out of API credits" or similar, we set a Redis flag with TTL until
 * next UTC midnight. All subsequent calls short-circuit and return null/[] without HTTP.
 * Saves credits and prevents log spam.
 */
const EXHAUSTED_KEY = 'twelvedata:exhausted';

function secondsUntilUTCMidnight(): number {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return Math.max(60, Math.ceil((tomorrow.getTime() - now.getTime()) / 1000));
}

async function isExhausted(): Promise<boolean> {
  return (await cacheGet<number>(EXHAUSTED_KEY)) === 1;
}

async function markExhausted(reason: string): Promise<void> {
  const ttl = secondsUntilUTCMidnight();
  await cacheSet(EXHAUSTED_KEY, 1, ttl);
  console.warn(`[TwelveData] CIRCUIT BREAKER tripped (${reason}) — skipping all calls for ${Math.round(ttl / 60)} min`);
}

function isCreditError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('api credits') || m.includes('ran out') || m.includes('rate limit');
}

function mapInterval(interval: '15m' | '1h' | '4h' | '1d'): string {
  if (interval === '15m') return '15min';
  if (interval === '1d') return '1day';
  return interval;
}

function parseTwelveDataSymbol(ticker: string): { symbol: string; exchange?: string } {
  const clean = ticker.toUpperCase().replace(/^[$^]/, '');
  const parts = clean.split(':');
  if (parts.length === 2) {
    return { symbol: parts[0], exchange: parts[1] };
  }
  return { symbol: clean };
}

async function getApiKey(): Promise<string> {
  return getCredential('twelve_data_key', 'TWELVE_DATA_KEY');
}

export async function getTwelveDataCurrentPrice(ticker: string): Promise<number | null> {
  const { symbol, exchange } = parseTwelveDataSymbol(ticker);
  const cacheKey = `twelvedata:price:${symbol}${exchange ? ':' + exchange : ''}`;
  const cached = await cacheGet<number>(cacheKey);
  if (cached) return cached;

  if (await isExhausted()) return null;

  const apikey = await getApiKey();
  if (!apikey) return null;

  try {
    const response = await axios.get(`${BASE_URL}/price`, {
      params: { symbol, ...(exchange && { exchange }), apikey },
      timeout: 10_000,
      validateStatus: () => true,
    });

    const price = parseFloat(response.data?.price);
    if (response.status === 200 && Number.isFinite(price) && price > 0) {
      await cacheSet(cacheKey, price, TTL.PRICE);
      return price;
    }

    const message = response.data?.message || response.data?.status || `HTTP ${response.status}`;
    if (isCreditError(message)) {
      await markExhausted(`price ${symbol}: ${message.slice(0, 80)}`);
      return null;
    }
    console.warn(`[TwelveData] price ${symbol}: ${message}`);
    return null;
  } catch (err) {
    console.warn(`[TwelveData] price ${symbol} failed: ${(err as Error).message}`);
    return null;
  }
}

export async function getTwelveDataOHLCV(
  ticker: string,
  interval: '15m' | '1h' | '4h' | '1d',
): Promise<OHLCVBar[]> {
  const { symbol, exchange } = parseTwelveDataSymbol(ticker);
  const cacheKey = `twelvedata:ohlcv:${symbol}${exchange ? ':' + exchange : ''}:${interval}`;
  const cached = await cacheGet<OHLCVBar[]>(cacheKey);
  if (cached) return cached;

  if (await isExhausted()) return [];

  const apikey = await getApiKey();
  if (!apikey) return [];

  try {
    const response = await axios.get(`${BASE_URL}/time_series`, {
      params: {
        symbol,
        ...(exchange && { exchange }),
        interval: mapInterval(interval),
        outputsize: interval === '15m' ? 120 : 160,
        order: 'ASC',
        apikey,
      },
      timeout: 15_000,
      validateStatus: () => true,
    });

    const values = response.data?.values;
    if (response.status !== 200 || !Array.isArray(values)) {
      const message = response.data?.message || response.data?.status || `HTTP ${response.status}`;
      if (isCreditError(message)) {
        await markExhausted(`ohlcv ${symbol} ${interval}: ${message.slice(0, 80)}`);
        return [];
      }
      console.warn(`[TwelveData] ohlcv ${symbol} ${interval}: ${message}`);
      return [];
    }

    const bars: OHLCVBar[] = values
      .map((bar: any) => ({
        time: new Date(`${bar.datetime}Z`).toISOString(),
        open: parseFloat(bar.open),
        high: parseFloat(bar.high),
        low: parseFloat(bar.low),
        close: parseFloat(bar.close),
        volume: parseFloat(bar.volume || '0') || 0,
      }))
      .filter((bar: OHLCVBar) =>
        Number.isFinite(bar.open) &&
        Number.isFinite(bar.high) &&
        Number.isFinite(bar.low) &&
        Number.isFinite(bar.close)
      );

    await cacheSet(cacheKey, bars, interval === '15m' ? TTL.OHLCV : TTL.FUNDAMENTALS);
    return bars;
  } catch (err) {
    console.warn(`[TwelveData] ohlcv ${symbol} ${interval} failed: ${(err as Error).message}`);
    return [];
  }
}
