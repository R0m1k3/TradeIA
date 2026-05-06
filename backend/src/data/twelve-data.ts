import axios from 'axios';
import { getCredential } from '../config/credentials';
import { cacheGet, cacheSet, TTL } from './cache';
import type { OHLCVBar } from './indicators';

const BASE_URL = 'https://api.twelvedata.com';

function mapInterval(interval: '15m' | '1h' | '4h' | '1d'): string {
  if (interval === '15m') return '15min';
  if (interval === '1d') return '1day';
  return interval;
}

function normalizeSymbol(ticker: string): string {
  return ticker.toUpperCase().replace(/^[$^]/, '');
}

async function getApiKey(): Promise<string> {
  return getCredential('twelve_data_key', 'TWELVE_DATA_KEY');
}

export async function getTwelveDataCurrentPrice(ticker: string): Promise<number | null> {
  const symbol = normalizeSymbol(ticker);
  const cacheKey = `twelvedata:price:${symbol}`;
  const cached = await cacheGet<number>(cacheKey);
  if (cached) return cached;

  const apikey = await getApiKey();
  if (!apikey) return null;

  try {
    const response = await axios.get(`${BASE_URL}/price`, {
      params: { symbol, apikey },
      timeout: 10_000,
      validateStatus: () => true,
    });

    const price = parseFloat(response.data?.price);
    if (response.status === 200 && Number.isFinite(price) && price > 0) {
      await cacheSet(cacheKey, price, TTL.PRICE);
      return price;
    }

    const message = response.data?.message || response.data?.status || `HTTP ${response.status}`;
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
  const symbol = normalizeSymbol(ticker);
  const cacheKey = `twelvedata:ohlcv:${symbol}:${interval}`;
  const cached = await cacheGet<OHLCVBar[]>(cacheKey);
  if (cached) return cached;

  const apikey = await getApiKey();
  if (!apikey) return [];

  try {
    const response = await axios.get(`${BASE_URL}/time_series`, {
      params: {
        symbol,
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
