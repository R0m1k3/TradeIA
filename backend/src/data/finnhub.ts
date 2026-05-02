import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';
import { getCredential } from '../config/credentials';

const BASE = 'https://finnhub.io/api/v1';

async function finnhubGet(path: string, params: Record<string, string> = {}): Promise<{ data: unknown; status: number }> {
  const key = await getCredential('finnhub_key', 'FINNHUB_KEY');
  if (!key) return { data: null, status: 0 };
  const response = await axios.get(`${BASE}${path}`, {
    params: { ...params, token: key },
    timeout: 15_000,
    validateStatus: () => true,
  });
  return { data: response.data, status: response.status };
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

// Track which endpoints returned 403 so we stop retrying
// Check before even making the request to avoid parallel 403 spam
const endpoint403 = new Set<string>();

export async function getTickerNews(ticker: string): Promise<NewsItem[]> {
  if (endpoint403.has('news')) return [];
  const cacheKey = `finnhub:news:${ticker}`;
  const cached = await cacheGet<NewsItem[]>(cacheKey);
  if (cached) return cached;

  try {
    const { data, status } = await finnhubGet('/company-news', { symbol: ticker, from: new Date(Date.now() - 48 * 3600 * 1000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });
    if (status === 403 || status === 401) {
      if (!endpoint403.has('news')) console.warn(`[Finnhub] getTickerNews 403 — plan limit, disabling for session`);
      endpoint403.add('news');
      return [];
    }
    if (status === 429) {
      console.warn(`[Finnhub] getTickerNews ${ticker} rate limited (429)`);
      return [];
    }
    const news = Array.isArray(data) ? (data as NewsItem[]).slice(0, 20) : [];
    await cacheSet(cacheKey, news, TTL.NEWS);
    return news;
  } catch (err) {
    console.warn(`[Finnhub] getTickerNews ${ticker} failed: ${(err as any)?.message || err}`);
    return [];
  }
}

export async function getSentiment(ticker: string): Promise<MarketSentiment> {
  if (endpoint403.has('sentiment')) return { sentiment_score: 0, buzz_score: 0 };
  const cacheKey = `finnhub:sentiment:${ticker}`;
  const cached = await cacheGet<MarketSentiment>(cacheKey);
  if (cached) return cached;

  try {
    const { data, status } = await finnhubGet('/news-sentiment', { symbol: ticker });
    if (status === 403 || status === 401) {
      if (!endpoint403.has('sentiment')) console.warn(`[Finnhub] getSentiment 403 — plan limit, disabling for session`);
      endpoint403.add('sentiment');
      return { sentiment_score: 0, buzz_score: 0 };
    }
    if (status === 429) {
      return { sentiment_score: 0, buzz_score: 0 };
    }
    const d = data as any;
    const bull = d.sentiment?.bullishPercent || 0.5;
    const bear = d.sentiment?.bearishPercent || 0.5;
    const result: MarketSentiment = {
      sentiment_score: Math.round((bull - bear) * 10),
      buzz_score: d.buzz?.buzz || 0,
    };
    await cacheSet(cacheKey, result, TTL.NEWS);
    return result;
  } catch (err) {
    console.warn(`[Finnhub] getSentiment ${ticker} failed: ${(err as any)?.message || err}`);
    return { sentiment_score: 0, buzz_score: 0 };
  }
}

export interface EarningsEvent {
  symbol: string;
  date: string;
  epsEstimate: number | null;
  revenueEstimate: number | null;
}

export async function getUpcomingEarnings(watchlist: string[]): Promise<Record<string, EarningsEvent>> {
  if (endpoint403.has('earnings')) return {};
  const cacheKey = 'finnhub:earnings_calendar';
  const cached = await cacheGet<Record<string, EarningsEvent>>(cacheKey);
  if (cached) return cached;

  const result: Record<string, EarningsEvent> = {};

  try {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 7 * 86400 * 1000).toISOString().slice(0, 10);
    const { data, status } = await finnhubGet('/calendar/earnings', { from, to });

    if (status === 403 || status === 401) {
      endpoint403.add('earnings');
      console.warn(`[Finnhub] getUpcomingEarnings 403 — plan limit, disabling`);
    } else if (status === 200) {
      const calendar = (data as any).earningsCalendar || [];
      const watchSet = new Set(watchlist.map((t) => t.toUpperCase()));
      for (const event of calendar) {
        if (watchSet.has(event.symbol?.toUpperCase())) {
          result[event.symbol] = {
            symbol: event.symbol, date: event.date,
            epsEstimate: event.epsEstimate ?? null, revenueEstimate: event.revenueEstimate ?? null,
          };
        }
      }
    }
  } catch (err) {
    console.warn(`[Finnhub] getUpcomingEarnings failed: ${(err as any)?.message || err}`);
  }

  await cacheSet(cacheKey, result, TTL.EARNINGS);
  return result;
}

export async function getMarketContext(): Promise<{
  vix: number;
  fear_greed: number;
  nasdaq_direction: string;
  nasdaq_change_pct: number;
}> {
  const cacheKey = 'finnhub:market_context';
  const cached = await cacheGet<{ vix: number; fear_greed: number; nasdaq_direction: string; nasdaq_change_pct: number }>(cacheKey);
  if (cached) return cached;

  const { getYahooVIX, getFearAndGreed, getNasdaqDirection } = await import('./yahoo');
  const [vix, fearGreed, nasdaqDir] = await Promise.allSettled([
    getYahooVIX(),
    getFearAndGreed(),
    getNasdaqDirection(),
  ]);

  const nasdaqData = nasdaqDir.status === 'fulfilled' ? nasdaqDir.value : { direction: 'neutral', change_pct: 0 };

  const result = {
    vix: vix.status === 'fulfilled' && vix.value ? vix.value : 18,
    fear_greed: fearGreed.status === 'fulfilled' && fearGreed.value ? fearGreed.value : 50,
    nasdaq_direction: nasdaqData.direction,
    nasdaq_change_pct: nasdaqData.change_pct,
  };

  console.log(`[Market] VIX=${result.vix} FearGreed=${result.fear_greed} Nasdaq=${result.nasdaq_direction} (${result.nasdaq_change_pct}%)`);
  await cacheSet(cacheKey, result, TTL.MARKET_CONTEXT);
  return result;
}