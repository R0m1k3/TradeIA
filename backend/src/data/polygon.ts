import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';
import { getCredential } from '../config/credentials';

const BASE = 'https://api.polygon.io';

async function polygonGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const key = await getCredential('polygon_key', 'POLYGON_KEY');
  const response = await axios.get(`${BASE}${path}`, {
    params: { ...params, apiKey: key },
    timeout: 15_000,
  });
  return response.data;
}

export interface OptionsData {
  put_call_ratio: number | null;
  iv30: number | null;
}

export async function getOptionsData(ticker: string): Promise<OptionsData> {

  const cacheKey = `polygon:options:${ticker}`;
  const cached = await cacheGet<OptionsData>(cacheKey);
  if (cached) return cached;

  try {
    const data = await polygonGet(`/v3/snapshot/options/${ticker}`) as {
      results?: Array<{ details?: { contract_type?: string }; implied_volatility?: number }>;
    };
    const results = data.results || [];
    const calls = results.filter((r) => r.details?.contract_type === 'call').length;
    const puts = results.filter((r) => r.details?.contract_type === 'put').length;
    const put_call_ratio = calls > 0 ? puts / calls : null;
    const ivs = results.map((r) => r.implied_volatility || 0).filter(Boolean);
    const iv30 = ivs.length > 0 ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

    const result: OptionsData = { put_call_ratio, iv30 };
    await cacheSet(cacheKey, result, TTL.OPTIONS);
    return result;
  } catch (err) {
    console.error(`[Polygon] getOptionsData ${ticker} error:`, err);
    return { put_call_ratio: null, iv30: null };
  }
}

export async function getDailyVolume(ticker: string): Promise<number | null> {
  const cacheKey = `polygon:volume:${ticker}`;
  const cached = await cacheGet<number>(cacheKey);
  if (cached) return cached;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const data = await polygonGet(`/v2/aggs/ticker/${ticker}/prev`) as {
      results?: Array<{ v?: number }>;
    };
    const vol = data.results?.[0]?.v || null;
    if (vol) await cacheSet(cacheKey, vol, TTL.OHLCV);
    return vol;
  } catch (err) {
    console.error(`[Polygon] getDailyVolume ${ticker} error:`, err);
    return null;
  }
}
export async function getMarketSnapshot(): Promise<any[]> {
  const cacheKey = 'polygon:snapshot';
  const cached = await cacheGet<any[]>(cacheKey);
  if (cached) return cached;

  try {
    const data = await polygonGet('/v2/snapshot/locale/us/markets/stocks/tickers') as {
      tickers?: any[];
      results?: any[]; // kept for safety — some endpoint versions use results
    };
    // Polygon V2 market snapshot returns `tickers`, not `results`
    const results = data.tickers || data.results || [];
    console.log(`[Polygon] Market snapshot: ${results.length} tickers fetched`);
    await cacheSet(cacheKey, results, TTL.OHLCV);
    return results;
  } catch (err) {
    console.error('[Polygon] getMarketSnapshot error:', err);
    return [];
  }
}
