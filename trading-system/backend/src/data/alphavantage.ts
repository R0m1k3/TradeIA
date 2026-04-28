import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';

const BASE = 'https://www.alphavantage.co/query';
const KEY = process.env.ALPHA_VANTAGE_KEY || 'demo';

export interface OHLCVBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Fundamentals {
  pe: number | null;
  eps: number | null;
  revenue_growth: number | null;
  debt_equity: number | null;
  earnings_date: string | null;
  market_cap: number | null;
}

async function avGet(params: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await axios.get(BASE, {
    params: { ...params, apikey: KEY },
    timeout: 15_000,
  });
  return response.data as Record<string, unknown>;
}

function parseIntraday(data: Record<string, unknown>, key: string): OHLCVBar[] {
  const series = data[key] as Record<string, Record<string, string>> | undefined;
  if (!series) return [];
  return Object.entries(series)
    .slice(0, 200)
    .map(([time, v]) => ({
      time,
      open: parseFloat(v['1. open'] || '0'),
      high: parseFloat(v['2. high'] || '0'),
      low: parseFloat(v['3. low'] || '0'),
      close: parseFloat(v['4. close'] || '0'),
      volume: parseFloat(v['5. volume'] || '0'),
    }));
}

export async function getIntraday(ticker: string, interval: '15min' | '60min'): Promise<OHLCVBar[]> {
  const cacheKey = `av:intraday:${ticker}:${interval}`;
  const cached = await cacheGet<OHLCVBar[]>(cacheKey);
  if (cached) return cached;

  try {
    const data = await avGet({
      function: 'TIME_SERIES_INTRADAY',
      symbol: ticker,
      interval,
      outputsize: 'compact',
    });
    const key = `Time Series (${interval})`;
    const bars = parseIntraday(data, key);
    if (bars.length > 0) await cacheSet(cacheKey, bars, TTL.OHLCV);
    return bars;
  } catch (err) {
    console.error(`[AlphaVantage] getIntraday ${ticker} ${interval} error:`, err);
    return [];
  }
}

export async function getDaily(ticker: string): Promise<OHLCVBar[]> {
  const cacheKey = `av:daily:${ticker}`;
  const cached = await cacheGet<OHLCVBar[]>(cacheKey);
  if (cached) return cached;

  try {
    const data = await avGet({ function: 'TIME_SERIES_DAILY', symbol: ticker, outputsize: 'compact' });
    const bars = parseIntraday(data, 'Time Series (Daily)');
    if (bars.length > 0) await cacheSet(cacheKey, bars, TTL.OHLCV);
    return bars;
  } catch (err) {
    console.error(`[AlphaVantage] getDaily ${ticker} error:`, err);
    return [];
  }
}

export async function getFundamentals(ticker: string): Promise<Fundamentals> {
  const cacheKey = `av:fundamentals:${ticker}`;
  const cached = await cacheGet<Fundamentals>(cacheKey);
  if (cached) return cached;

  try {
    const data = await avGet({ function: 'OVERVIEW', symbol: ticker });
    const result: Fundamentals = {
      pe: data['PERatio'] ? parseFloat(data['PERatio'] as string) : null,
      eps: data['EPS'] ? parseFloat(data['EPS'] as string) : null,
      revenue_growth: data['QuarterlyRevenueGrowthYOY']
        ? parseFloat(data['QuarterlyRevenueGrowthYOY'] as string)
        : null,
      debt_equity: data['DebtToEquityRatio']
        ? parseFloat(data['DebtToEquityRatio'] as string)
        : null,
      earnings_date: (data['NextEarningsDate'] as string) || null,
      market_cap: data['MarketCapitalization']
        ? parseFloat(data['MarketCapitalization'] as string)
        : null,
    };
    await cacheSet(cacheKey, result, TTL.FUNDAMENTALS);
    return result;
  } catch (err) {
    console.error(`[AlphaVantage] getFundamentals ${ticker} error:`, err);
    return { pe: null, eps: null, revenue_growth: null, debt_equity: null, earnings_date: null, market_cap: null };
  }
}

export async function getCurrentPrice(ticker: string): Promise<number | null> {
  const cacheKey = `av:price:${ticker}`;
  const cached = await cacheGet<number>(cacheKey);
  if (cached) return cached;

  try {
    const data = await avGet({ function: 'GLOBAL_QUOTE', symbol: ticker });
    const quote = data['Global Quote'] as Record<string, string> | undefined;
    const price = quote ? parseFloat(quote['05. price'] || '0') : null;
    if (price) await cacheSet(cacheKey, price, TTL.PRICE);
    return price;
  } catch (err) {
    console.error(`[AlphaVantage] getCurrentPrice ${ticker} error:`, err);
    return null;
  }
}
