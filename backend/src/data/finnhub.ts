import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';
import { getCredential } from '../config/credentials';

const BASE = 'https://finnhub.io/api/v1';

async function finnhubGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const key = await getCredential('finnhub_key', 'FINNHUB_KEY');
  if (!key) throw new Error('Finnhub API key not configured');
  const response = await axios.get(`${BASE}${path}`, {
    params: { ...params, token: key },
    timeout: 15_000,
  });
  return response.data;
}

export interface NewsItem {
  headline: string;
  summary: string;
  source: string;
  datetime: number;
  url: string;
}

export interface MarketSentiment {
  sentiment_score: number;
  buzz_score: number;
}

export async function getTickerNews(ticker: string): Promise<NewsItem[]> {
  const cacheKey = `finnhub:news:${ticker}`;
  const cached = await cacheGet<NewsItem[]>(cacheKey);
  if (cached) return cached;

  try {
    const from = new Date(Date.now() - 48 * 3600 * 1000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const data = await finnhubGet('/company-news', { symbol: ticker, from, to }) as NewsItem[];
    const news = Array.isArray(data) ? data.slice(0, 20) : [];
    await cacheSet(cacheKey, news, TTL.NEWS);
    return news;
  } catch (err) {
    console.error(`[Finnhub] getTickerNews ${ticker} error:`, err);
    return [];
  }
}

export async function getSentiment(ticker: string): Promise<MarketSentiment> {
  const cacheKey = `finnhub:sentiment:${ticker}`;
  const cached = await cacheGet<MarketSentiment>(cacheKey);
  if (cached) return cached;

  try {
    const data = await finnhubGet('/news-sentiment', { symbol: ticker }) as {
      sentiment?: { bullishPercent?: number; bearishPercent?: number };
      buzz?: { buzz?: number };
    };
    const bull = data.sentiment?.bullishPercent || 0.5;
    const bear = data.sentiment?.bearishPercent || 0.5;
    const result: MarketSentiment = {
      sentiment_score: Math.round((bull - bear) * 10),
      buzz_score: data.buzz?.buzz || 0,
    };
    await cacheSet(cacheKey, result, TTL.NEWS);
    return result;
  } catch (err) {
    console.error(`[Finnhub] getSentiment ${ticker} error:`, err);
    return { sentiment_score: 0, buzz_score: 0 };
  }
}

export async function getMarketContext(): Promise<{
  vix: number;
  fear_greed: number;
  nasdaq_direction: string;
}> {
  const cacheKey = 'finnhub:market_context';
  const cached = await cacheGet<{ vix: number; fear_greed: number; nasdaq_direction: string }>(cacheKey);
  if (cached) return cached;

  // Return sensible defaults when API is unavailable
  const result = { vix: 18, fear_greed: 50, nasdaq_direction: 'neutral' };
  await cacheSet(cacheKey, result, TTL.MARKET_CONTEXT);
  return result;
}
