import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';
import type { OHLCVBar, Fundamentals } from './alphavantage';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SUMMARY = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

function unixToISO(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

// Fetch a crumb from Yahoo to authenticate v8/v10 endpoints
let cachedCrumb: string | null = null;
let crumbExpiry = 0;
let crumbLogged = false;

async function getYahooCrumb(): Promise<string | null> {
  if (cachedCrumb && Date.now() < crumbExpiry) return cachedCrumb;
  try {
    const sessionRes = await axios.get('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: YAHOO_HEADERS,
      timeout: 10_000,
    });
    if (typeof sessionRes.data === 'string' && sessionRes.data.length > 5) {
      cachedCrumb = sessionRes.data;
      crumbExpiry = Date.now() + 3600_000;
      console.log('[Yahoo] Got crumb for authenticated requests');
      return cachedCrumb;
    }
  } catch {
    if (!crumbLogged) {
      console.warn('[Yahoo] Could not get crumb — fundamentals unavailable without auth');
      crumbLogged = true;
    }
  }
  return null;
}

interface YahooChartResult {
  meta?: { regularMarketPrice?: number; currency?: string };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }>;
  };
}

export async function getYahooOHLCV(ticker: string, interval: '15m' | '1h' | '4h' | '1d', range: string = '1mo'): Promise<OHLCVBar[]> {
  const cacheKey = `yahoo:ohlcv:${ticker}:${interval}`;
  const cached = await cacheGet<OHLCVBar[]>(cacheKey);
  if (cached) return cached;

  try {
    const yahooInterval = interval === '4h' ? '1h' : interval === '1d' ? '1d' : interval;
    const yahooRange = interval === '15m' ? '5d' : interval === '1h' ? '1mo' : range;

    const crumb = await getYahooCrumb();
    const params: Record<string, string> = { interval: yahooInterval, range: yahooRange };
    if (crumb) params.crumb = crumb;

    const response = await axios.get(`${BASE}/${ticker}`, {
      params,
      headers: YAHOO_HEADERS,
      timeout: 15_000,
      validateStatus: () => true, // Don't throw on 401/404
    });

    if (response.status === 401 || response.status === 404) {
      console.warn(`[Yahoo] getOHLCV ${ticker} ${interval}: HTTP ${response.status} — skipping`);
      return [];
    }

    const result: YahooChartResult = response.data?.chart?.result?.[0];
    if (!result?.timestamp || !result?.indicators?.quote?.[0]) return [];

    const quote = result.indicators.quote[0];
    const bars: OHLCVBar[] = [];

    for (let i = 0; i < result.timestamp.length; i++) {
      const o = quote.open?.[i];
      const h = quote.high?.[i];
      const l = quote.low?.[i];
      const c = quote.close?.[i];
      const v = quote.volume?.[i];

      if (o != null && h != null && l != null && c != null) {
        bars.push({
          time: unixToISO(result.timestamp[i]),
          open: o, high: h, low: l, close: c, volume: v ?? 0,
        });
      }
    }

    await cacheSet(cacheKey, bars, interval === '15m' ? TTL.OHLCV : TTL.FUNDAMENTALS);
    return bars;
  } catch (err) {
    console.warn(`[Yahoo] getOHLCV ${ticker} ${interval} failed: ${(err as Error).message}`);
    return [];
  }
}

export async function getYahooCurrentPrice(ticker: string): Promise<number | null> {
  const cacheKey = `yahoo:price:${ticker}`;
  const cached = await cacheGet<number>(cacheKey);
  if (cached) return cached;

  try {
    const crumb = await getYahooCrumb();
    const params: Record<string, string> = { interval: '1d', range: '1d' };
    if (crumb) params.crumb = crumb;

    const response = await axios.get(`${BASE}/${ticker}`, {
      params,
      headers: YAHOO_HEADERS,
      timeout: 10_000,
      validateStatus: () => true,
    });

    if (response.status === 401 || response.status === 404) {
      console.warn(`[Yahoo] getCurrentPrice ${ticker}: HTTP ${response.status}`);
      return null;
    }

    const price = response.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (price) {
      await cacheSet(cacheKey, price, TTL.PRICE);
      return price;
    }
    return null;
  } catch (err) {
    console.warn(`[Yahoo] getCurrentPrice ${ticker} failed: ${(err as Error).message}`);
    return null;
  }
}

export async function getYahooFundamentals(ticker: string): Promise<Fundamentals> {
  const cacheKey = `yahoo:fundamentals:${ticker}`;
  const cached = await cacheGet<Fundamentals>(cacheKey);
  if (cached) return cached;

  const empty: Fundamentals = {
    pe: null, eps: null, revenue_growth: null, debt_equity: null, earnings_date: null, market_cap: null,
  };

  // Try quoteSummary with crumb first
  const crumb = await getYahooCrumb();
  if (crumb) {
    try {
      const params: Record<string, string> = { modules: 'defaultKeyStatistics,financialData,earnings', crumb };
      const response = await axios.get(`${SUMMARY}/${ticker}`, {
        params,
        headers: YAHOO_HEADERS,
        timeout: 15_000,
        validateStatus: () => true,
      });

      if (response.status === 200) {
        const stats = response.data?.quoteSummary?.result?.[0];
        if (stats) {
          const result: Fundamentals = {
            pe: stats.defaultKeyStatistics?.forwardPE?.raw ?? null,
            eps: stats.defaultKeyStatistics?.trailingEps?.raw ?? null,
            revenue_growth: stats.financialData?.revenueGrowth?.raw ?? null,
            debt_equity: stats.financialData?.debtToEquity ?? null,
            earnings_date: stats.earnings?.financialsChart?.quarterly?.[0]?.date ?? null,
            market_cap: stats.defaultKeyStatistics?.enterpriseValue?.raw ?? null,
          };
          await cacheSet(cacheKey, result, TTL.FUNDAMENTALS);
          return result;
        }
      }
    } catch {
      // quoteSummary failed, fall through
    }
  }

  // Fallback: extract what we can from v8 chart metadata (market cap via price)
  try {
    const chartParams: Record<string, string> = { interval: '1d', range: '1d' };
    if (crumb) chartParams.crumb = crumb;

    const response = await axios.get(`${BASE}/${ticker}`, {
      params: chartParams,
      headers: YAHOO_HEADERS,
      timeout: 10_000,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      await cacheSet(cacheKey, empty, TTL.FUNDAMENTALS);
      return empty;
    }

    const meta = response.data?.chart?.result?.[0]?.meta;
    const result: Fundamentals = {
      pe: null,
      eps: null,
      revenue_growth: null,
      debt_equity: null,
      earnings_date: null,
      market_cap: meta?.marketCap ?? null,
    };

    await cacheSet(cacheKey, result, TTL.FUNDAMENTALS);
    return result;
  } catch {
    await cacheSet(cacheKey, empty, TTL.FUNDAMENTALS);
    return empty;
  }
}

/** Fetch VIX index value from Yahoo */
export async function getYahooVIX(): Promise<number | null> {
  const cacheKey = 'yahoo:vix';
  const cached = await cacheGet<number>(cacheKey);
  if (cached) return cached;

  try {
    const crumb = await getYahooCrumb();
    const params: Record<string, string> = { interval: '1d', range: '5d' };
    if (crumb) params.crumb = crumb;

    const response = await axios.get(`${BASE}/%5EVIX`, {
      params,
      headers: YAHOO_HEADERS,
      timeout: 10_000,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      console.warn(`[Yahoo] getVIX: HTTP ${response.status}`);
      return null;
    }

    const price = response.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (price) {
      await cacheSet(cacheKey, price, TTL.MARKET_CONTEXT);
      return price;
    }
    return null;
  } catch (err) {
    console.warn(`[Yahoo] getVIX failed: ${(err as Error).message}`);
    return null;
  }
}

/** Fetch Fear & Greed index — tries CNN, then alternative API */
export async function getFearAndGreed(): Promise<number | null> {
  const cacheKey = 'market:fear_greed';
  const cached = await cacheGet<number>(cacheKey);
  if (cached) return cached;

  // Try CNN first
  try {
    const response = await axios.get(
      'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
      { timeout: 10_000, validateStatus: () => true }
    );
    if (response.status === 200) {
      const data = response.data;
      const fg = data?.fear_and_greed?.score ?? data?.fear_and_greed_index?.score ?? null;
      if (fg !== null) {
        await cacheSet(cacheKey, fg, TTL.MARKET_CONTEXT);
        return fg;
      }
    }
  } catch {
    // CNN blocked, try alternative
  }

  // Alternative: fear-and-greed.com API
  try {
    const response = await axios.get('https://api.alternative.me/fng/?limit=1', {
      timeout: 10_000,
      validateStatus: () => true,
    });
    if (response.status === 200 && response.data?.data?.[0]?.value) {
      const fg = parseInt(response.data.data[0].value, 10);
      if (!isNaN(fg)) {
        console.log(`[Market] FearGreed from alternative.me: ${fg}`);
        await cacheSet(cacheKey, fg, TTL.MARKET_CONTEXT);
        return fg;
      }
    }
  } catch {
    // Alternative also failed
  }

  console.warn('[Market] FearGreed unavailable — using default 50');
  return null;
}

/** Fetch QQQ daily change for Nasdaq direction + change % */
export async function getNasdaqDirection(): Promise<{ direction: string; change_pct: number }> {
  const cacheKey = 'yahoo:nasdaq_dir';
  const cached = await cacheGet<{ direction: string; change_pct: number }>(cacheKey);
  if (cached) return cached;

  try {
    const crumb = await getYahooCrumb();
    const params: Record<string, string> = { interval: '1d', range: '5d' };
    if (crumb) params.crumb = crumb;

    const response = await axios.get(`${BASE}/QQQ`, {
      params,
      headers: YAHOO_HEADERS,
      timeout: 10_000,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      console.warn(`[Yahoo] getNasdaqDirection: HTTP ${response.status}`);
      return { direction: 'neutral', change_pct: 0 };
    }

    const result: YahooChartResult = response.data?.chart?.result?.[0];
    const closes = result?.indicators?.quote?.[0]?.close?.filter((c): c is number => c !== null) ?? [];

    if (closes.length >= 2) {
      const today = closes[closes.length - 1];
      const yesterday = closes[closes.length - 2];
      const change = ((today - yesterday) / yesterday) * 100;

      const dir = change > 0.5 ? 'bullish' : change < -0.5 ? 'bearish' : 'neutral';
      const data = { direction: dir, change_pct: Math.round(change * 100) / 100 };
      await cacheSet(cacheKey, data, TTL.MARKET_CONTEXT);
      return data;
    }
    return { direction: 'neutral', change_pct: 0 };
  } catch (err) {
    console.warn(`[Yahoo] getNasdaqDirection failed: ${(err as Error).message}`);
    return { direction: 'neutral', change_pct: 0 };
  }
}