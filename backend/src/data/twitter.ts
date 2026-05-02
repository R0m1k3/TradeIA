import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';
import { getCredential } from '../config/credentials';

const BASE = 'https://api.socialdata.tools';

export interface TweetData {
  text: string;
  author: string;
  created_at: string;
  likes: number;
  retweets: number;
  sentiment_hint: 'bullish' | 'bearish' | 'neutral';
}

/**
 * Fetch recent tweets about a stock ticker from X/Twitter.
 * Uses SocialData API (freemium) — falls back gracefully if no key or rate limited.
 */
export async function getTickerTweets(ticker: string, limit = 10): Promise<TweetData[]> {
  const cacheKey = `twitter:tweets:${ticker}`;
  const cached = await cacheGet<TweetData[]>(cacheKey);
  if (cached) return cached;

  const key = await getCredential('socialdata_key', 'SOCIALDATA_KEY');
  if (!key) return [];

  try {
    const response = await axios.get(`${BASE}/twitter/search`, {
      params: {
        query: `(${ticker} OR $${ticker}) (stock OR trading OR analysis OR breakout OR support OR resistance OR earnings) -is:retweet lang:en`,
        type: 'Latest',
        max_results: limit,
      },
      headers: { Authorization: `Bearer ${key}` },
      timeout: 15_000,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      console.warn(`[Twitter] getTickerTweets ${ticker}: HTTP ${response.status}`);
      return [];
    }

    const tweets = (response.data?.tweets || []).slice(0, limit).map((t: any) => ({
      text: t.text?.slice(0, 200) || '',
      author: t.author?.username || 'unknown',
      created_at: t.created_at || '',
      likes: t.favorite_count || 0,
      retweets: t.retweet_count || 0,
      sentiment_hint: detectSentiment(t.text || ''),
    })) as TweetData[];

    await cacheSet(cacheKey, tweets, TTL.NEWS);
    return tweets;
  } catch (err) {
    console.warn(`[Twitter] getTickerTweets ${ticker} failed: ${(err as any)?.message || err}`);
    return [];
  }
}

/**
 * Fetch trending financial tweets (general market sentiment).
 * Useful when markets are closed — still captures weekend sentiment.
 */
export async function getFinancialSentimentTweets(): Promise<TweetData[]> {
  const cacheKey = 'twitter:financial_sentiment';
  const cached = await cacheGet<TweetData[]>(cacheKey);
  if (cached) return cached;

  const key = await getCredential('socialdata_key', 'SOCIALDATA_KEY');
  if (!key) return [];

  try {
    const response = await axios.get(`${BASE}/twitter/search`, {
      params: {
        query: '(stocks OR market OR NASDAQ OR S&P500 OR Fed OR earnings) (bullish OR bearish OR rally OR selloff OR breakout) min_faves:10 -is:retweet lang:en',
        type: 'Top',
        max_results: 15,
      },
      headers: { Authorization: `Bearer ${key}` },
      timeout: 15_000,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      console.warn(`[Twitter] getFinancialSentimentTweets: HTTP ${response.status}`);
      return [];
    }

    const tweets = (response.data?.tweets || []).slice(0, 15).map((t: any) => ({
      text: t.text?.slice(0, 200) || '',
      author: t.author?.username || 'unknown',
      created_at: t.created_at || '',
      likes: t.favorite_count || 0,
      retweets: t.retweet_count || 0,
      sentiment_hint: detectSentiment(t.text || ''),
    })) as TweetData[];

    await cacheSet(cacheKey, tweets, TTL.MARKET_CONTEXT);
    return tweets;
  } catch (err) {
    console.warn(`[Twitter] getFinancialSentimentTweets failed: ${(err as any)?.message || err}`);
    return [];
  }
}

function detectSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
  const lower = text.toLowerCase();
  const bullishWords = ['bullish', 'buy', 'rally', 'breakout', 'moon', 'upside', 'long', 'calls', 'upgrade', 'beat', 'growth', 'soar', 'gain', 'upgrade'];
  const bearishWords = ['bearish', 'sell', 'crash', 'selloff', 'short', 'puts', 'downgrade', 'miss', 'recession', 'drop', 'fall', 'risk', 'fear', 'dive', 'loss'];

  let bull = 0, bear = 0;
  for (const w of bullishWords) if (lower.includes(w)) bull++;
  for (const w of bearishWords) if (lower.includes(w)) bear++;

  if (bull > bear + 1) return 'bullish';
  if (bear > bull + 1) return 'bearish';
  return 'neutral';
}