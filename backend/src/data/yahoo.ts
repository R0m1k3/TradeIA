import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';
import { getCredential } from '../config/credentials';
import type { OHLCVBar, Fundamentals } from './alphavantage';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SUMMARY = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

function unixToISO(ts: number): string {
  return new Date(ts * 1000).toISOString();
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

    const response = await axios.get(`${BASE}/${ticker}`, {
      params: { interval: yahooInterval, range: yahooRange },
      headers: YAHOO_HEADERS,
      timeout: 15_000,
    });

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
          open: o,
          high: h,
          low: l,
          close: c,
          volume: v ?? 0,
        });
      }
    }

    await cacheSet(cacheKey, bars, interval === '15m' ? TTL.OHLCV : TTL.FUNDAMENTALS);
    return bars;
  } catch (err) {
    console.error(`[Yahoo] getOHLCV ${ticker} ${interval} error:`, (err as Error).message);
    return [];
  }
}

export async function getYahooCurrentPrice(ticker: string): Promise<number | null> {
  const cacheKey = `yahoo:price:${ticker}`;
  const cached = await cacheGet<number>(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(`${BASE}/${ticker}`, {
      params: { interval: '1d', range: '1d' },
      headers: YAHOO_HEADERS,
      timeout: 10_000,
    });

    const price = response.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (price) {
      await cacheSet(cacheKey, price, TTL.PRICE);
      return price;
    }
    return null;
  } catch (err) {
    console.error(`[Yahoo] getCurrentPrice ${ticker} error:`, (err as Error).message);
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

  try {
    const response = await axios.get(`${SUMMARY}/${ticker}`, {
      params: { modules: 'defaultKeyStatistics,financialData,earnings' },
      headers: YAHOO_HEADERS,
      timeout: 15_000,
    });

    const stats = response.data?.quoteSummary?.result?.[0];
    if (!stats) return empty;

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
  } catch (err) {
    console.error(`[Yahoo] getFundamentals ${ticker} error:`, (err as Error).message);
    return empty;
  }
}

/** Fetch VIX index value from Yahoo */
export async function getYahooVIX(): Promise<number | null> {
  const cacheKey = 'yahoo:vix';
  const cached = await cacheGet<number>(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(`${BASE}/%5EVIX`, {
      params: { interval: '1d', range: '5d' },
      headers: YAHOO_HEADERS,
      timeout: 10_000,
    });

    const price = response.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (price) {
      await cacheSet(cacheKey, price, TTL.MARKET_CONTEXT);
      return price;
    }
    return null;
  } catch (err) {
    console.error('[Yahoo] getVIX error:', (err as Error).message);
    return null;
  }
}

/** Fetch Fear & Greed index from CNN (free, no API key) */
export async function getFearAndGreed(): Promise<number | null> {
  const cacheKey = 'market:fear_greed';
  const cached = await cacheGet<number>(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(
      'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
      { timeout: 10_000 }
    );

    const data = response.data;
    const fg = data?.fear_and_greed?.score ?? data?.fear_and_greed_index?.score ?? null;
    if (fg !== null) {
      await cacheSet(cacheKey, fg, TTL.MARKET_CONTEXT);
      return fg;
    }
    return null;
  } catch (err) {
    console.error('[Market] getFearAndGreed error:', (err as Error).message);
    return null;
  }
}

/** Fetch QQQ daily change for Nasdaq direction + change % */
export async function getNasdaqDirection(): Promise<{ direction: string; change_pct: number }> {
  const cacheKey = 'yahoo:nasdaq_dir';
  const cached = await cacheGet<{ direction: string; change_pct: number }>(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(`${BASE}/QQQ`, {
      params: { interval: '1d', range: '5d' },
      headers: YAHOO_HEADERS,
      timeout: 10_000,
    });

    const result: YahooChartResult = response.data?.chart?.result?.[0];
    const closes = result?.indicators?.quote?.[0]?.close?.filter((c): c is number => c !== null) ?? [];

    if (closes.length >= 2) {
      const today = closes[closes.length - 1];
      const yesterday = closes[closes.length - 2];
      const change = ((today - yesterday) / yesterday) * 100;

      const dir = change > 0.5 ? 'bullish' : change < -0.5 ? 'bearish' : 'neutral';
      const result = { direction: dir, change_pct: Math.round(change * 100) / 100 };
      await cacheSet(cacheKey, result, TTL.MARKET_CONTEXT);
      return result;
    }
    return { direction: 'neutral', change_pct: 0 };
  } catch (err) {
    console.error('[Yahoo] getNasdaqDirection error:', (err as Error).message);
    return { direction: 'neutral', change_pct: 0 };
  }
}