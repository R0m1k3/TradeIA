import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';

const BASE = 'https://api.stocktwits.com/api/2';

export interface StockTwitsMessage {
  body: string;
  author: string;
  created_at: string;
  likes: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  symbols: string[];
}

// Circuit breaker: disable for 24h after persistent 403/401
let disabledUntil = 0;

function isDisabled(): boolean {
  return Date.now() < disabledUntil;
}

function normalizeSentiment(s: string): 'bullish' | 'bearish' | 'neutral' {
  const lower = s.toLowerCase();
  if (lower === 'bullish') return 'bullish';
  if (lower === 'bearish') return 'bearish';
  return 'neutral';
}

/**
 * Fetch recent StockTwits messages about a stock ticker.
 * Public API — circuit breaker disables for 24h on 403/401.
 */
export async function getTickerStockTwits(ticker: string, limit = 10): Promise<StockTwitsMessage[]> {
  if (isDisabled()) return [];

  const cacheKey = `stocktwits:ticker:${ticker}`;
  const cached = await cacheGet<StockTwitsMessage[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(`${BASE}/streams/symbol/${encodeURIComponent(ticker)}.json`, {
      params: { limit },
      headers: { Accept: 'application/json' },
      timeout: 10_000,
      validateStatus: () => true,
    });

    if (response.status === 403 || response.status === 401) {
      console.warn(`[StockTwits] Blocked (${response.status}) — disabling for 24h`);
      disabledUntil = Date.now() + 24 * 3600000;
      return [];
    }

    if (response.status !== 200) {
      console.warn(`[StockTwits] getTickerStockTwits ${ticker}: HTTP ${response.status}`);
      return [];
    }

    const messages = (response.data?.messages || []).slice(0, limit).map((m: any) => ({
      body: m.body?.slice(0, 300) || '',
      author: m.user?.username || 'unknown',
      created_at: m.created_at || '',
      likes: m.likes?.total || 0,
      sentiment: normalizeSentiment(m.entities?.sentiment?.basic || 'neutral'),
      symbols: (m.symbols || []).map((s: any) => s.symbol),
    })) as StockTwitsMessage[];

    await cacheSet(cacheKey, messages, TTL.NEWS);
    return messages;
  } catch (err) {
    console.warn(`[StockTwits] getTickerStockTwits ${ticker} failed: ${(err as any)?.message || err}`);
    return [];
  }
}

/**
 * Fetch trending messages from StockTwits (general market sentiment).
 * Circuit breaker disables for 24h on 403/401.
 */
export async function getTrendingStockTwits(limit = 15): Promise<StockTwitsMessage[]> {
  if (isDisabled()) return [];

  const cacheKey = 'stocktwits:trending';
  const cached = await cacheGet<StockTwitsMessage[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(`${BASE}/streams/trending.json`, {
      params: { limit },
      headers: { Accept: 'application/json' },
      timeout: 10_000,
      validateStatus: () => true,
    });

    if (response.status === 403 || response.status === 401) {
      console.warn(`[StockTwits] Blocked (${response.status}) — disabling for 24h`);
      disabledUntil = Date.now() + 24 * 3600000;
      return [];
    }

    if (response.status !== 200) {
      console.warn(`[StockTwits] getTrendingStockTwits: HTTP ${response.status}`);
      return [];
    }

    const messages = (response.data?.messages || []).slice(0, limit).map((m: any) => ({
      body: m.body?.slice(0, 300) || '',
      author: m.user?.username || 'unknown',
      created_at: m.created_at || '',
      likes: m.likes?.total || 0,
      sentiment: normalizeSentiment(m.entities?.sentiment?.basic || 'neutral'),
      symbols: (m.symbols || []).map((s: any) => s.symbol),
    })) as StockTwitsMessage[];

    await cacheSet(cacheKey, messages, TTL.MARKET_CONTEXT);
    return messages;
  } catch (err) {
    console.warn(`[StockTwits] getTrendingStockTwits failed: ${(err as any)?.message || err}`);
    return [];
  }
}