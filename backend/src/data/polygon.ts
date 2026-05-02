import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';
import { getCredential } from '../config/credentials';

const BASE = 'https://api.polygon.io';

async function polygonGet(path: string, params: Record<string, string> = {}): Promise<{ data: unknown; status: number }> {
  const key = await getCredential('polygon_key', 'POLYGON_KEY');
  const response = await axios.get(`${BASE}${path}`, {
    params: { ...params, apiKey: key },
    timeout: 15_000,
    validateStatus: () => true, // Don't throw on non-2xx — handle errors ourselves
  });
  return { data: response.data, status: response.status };
}

export interface OptionsData {
  put_call_ratio: number | null;
  iv30: number | null;
}

export async function getOptionsData(ticker: string): Promise<OptionsData> {
  const cacheKey = `polygon:options:${ticker}`;
  const cached = await cacheGet<OptionsData>(cacheKey);
  if (cached) return cached;

  const nullResult: OptionsData = { put_call_ratio: null, iv30: null };

  // Options snapshot requires a paid Polygon plan — skip if no key or plan limit
  const key = await getCredential('polygon_key', 'POLYGON_KEY');
  if (!key) return nullResult;

  try {
    const { data, status } = await polygonGet(`/v3/snapshot/options/${ticker}`);
    if (status === 403 || (data as any).status === 'NOT_AUTHORIZED') {
      console.warn(`[Polygon] Options not available for ${ticker} (plan limit) — caching null`);
      await cacheSet(cacheKey, nullResult, TTL.OPTIONS);
      return nullResult;
    }
    const results = (data as any).results || [];
    const calls = results.filter((r: any) => r.details?.contract_type === 'call').length;
    const puts = results.filter((r: any) => r.details?.contract_type === 'put').length;
    const put_call_ratio = calls > 0 ? puts / calls : null;
    const ivs = results.map((r: any) => r.implied_volatility || 0).filter(Boolean);
    const iv30 = ivs.length > 0 ? ivs.reduce((a: number, b: number) => a + b, 0) / ivs.length : null;

    const result: OptionsData = { put_call_ratio, iv30 };
    await cacheSet(cacheKey, result, TTL.OPTIONS);
    return result;
  } catch (err: any) {
    console.warn(`[Polygon] getOptionsData ${ticker} failed: ${err?.message || err}`);
    return nullResult;
  }
}

export async function getDailyVolume(ticker: string): Promise<number | null> {
  const cacheKey = `polygon:volume:${ticker}`;
  const cached = await cacheGet<number>(cacheKey);
  if (cached) return cached;

  const key = await getCredential('polygon_key', 'POLYGON_KEY');
  if (!key) return null;

  try {
    const { data, status } = await polygonGet(`/v2/aggs/ticker/${ticker}/prev`);
    if (status !== 200) {
      console.warn(`[Polygon] getDailyVolume ${ticker}: HTTP ${status}`);
      return null;
    }
    const vol = (data as any).results?.[0]?.v || null;
    if (vol) await cacheSet(cacheKey, vol, TTL.OHLCV);
    return vol;
  } catch (err: any) {
    console.warn(`[Polygon] getDailyVolume ${ticker} failed: ${err?.message || err}`);
    return null;
  }
}

export async function getMarketSnapshot(): Promise<any[]> {
  const cacheKey = 'polygon:snapshot';
  const cached = await cacheGet<any[]>(cacheKey);
  if (cached) return cached;

  const key = await getCredential('polygon_key', 'POLYGON_KEY');
  if (!key) return [];

  try {
    const { data, status } = await polygonGet('/v2/snapshot/locale/us/markets/stocks/tickers');
    if (status !== 200) {
      console.warn(`[Polygon] getMarketSnapshot: HTTP ${status}`);
      return [];
    }
    const results = (data as any).tickers || (data as any).results || [];
    console.log(`[Polygon] Market snapshot: ${results.length} tickers`);
    await cacheSet(cacheKey, results, TTL.OHLCV);
    return results;
  } catch (err: any) {
    console.warn(`[Polygon] getMarketSnapshot failed: ${err?.message || err}`);
    return [];
  }
}