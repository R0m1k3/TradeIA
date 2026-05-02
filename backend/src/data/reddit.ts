import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';

const BASE = 'https://www.reddit.com';

export interface RedditPost {
  title: string;
  selftext: string;
  author: string;
  created_utc: number;
  score: number;
  num_comments: number;
  sentiment_hint: 'bullish' | 'bearish' | 'neutral';
  subreddit: string;
  url: string;
}

const FINANCE_SUBS = [
  'stocks',
  'wallstreetbets',
  'options',
  'investing',
  'stockmarket',
];

function detectSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
  const lower = text.toLowerCase();
  const bullishWords = ['bullish', 'buy', 'rally', 'breakout', 'moon', 'upside', 'long', 'calls', 'upgrade', 'beat', 'growth', 'soar', 'gain', 'pump', 'rocket', '🚀'];
  const bearishWords = ['bearish', 'sell', 'crash', 'selloff', 'short', 'puts', 'downgrade', 'miss', 'recession', 'drop', 'fall', 'risk', 'fear', 'dive', 'loss', 'tank', 'baghold'];

  let bull = 0, bear = 0;
  for (const w of bullishWords) if (lower.includes(w)) bull++;
  for (const w of bearishWords) if (lower.includes(w)) bear++;

  if (bull > bear + 1) return 'bullish';
  if (bear > bull + 1) return 'bearish';
  return 'neutral';
}

/**
 * Fetch recent Reddit posts about a stock ticker from finance subreddits.
 * No API key needed — uses public Reddit JSON endpoints.
 */
export async function getTickerRedditPosts(ticker: string, limit = 10): Promise<RedditPost[]> {
  const cacheKey = `reddit:ticker:${ticker}`;
  const cached = await cacheGet<RedditPost[]>(cacheKey);
  if (cached) return cached;

  const query = `${ticker} OR $${ticker}`;
  const subreddits = FINANCE_SUBS.join('+');

  try {
    const response = await axios.get(`${BASE}/search.json`, {
      params: {
        q: query,
        restrict_sr: 'on',
        sort: 'new',
        limit,
        t: 'day',
      },
      headers: {
        'User-Agent': 'TradeIA/1.0 (trading bot)',
        Accept: 'application/json',
      },
      timeout: 10_000,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      // Reddit rate-limits — return empty rather than crash
      console.warn(`[Reddit] getTickerRedditPosts ${ticker}: HTTP ${response.status}`);
      return [];
    }

    const posts = (response.data?.data?.children || [])
      .map((child: any) => child?.data)
      .filter((p: any) => p && p.title)
      .slice(0, limit)
      .map((p: any) => ({
        title: p.title?.slice(0, 300) || '',
        selftext: p.selftext?.slice(0, 500) || '',
        author: p.author || 'unknown',
        created_utc: p.created_utc || 0,
        score: p.score || 0,
        num_comments: p.num_comments || 0,
        sentiment_hint: detectSentiment(`${p.title} ${p.selftext}`),
        subreddit: p.subreddit || '',
        url: `https://reddit.com${p.permalink || ''}`,
      })) as RedditPost[];

    await cacheSet(cacheKey, posts, TTL.NEWS);
    return posts;
  } catch (err) {
    console.warn(`[Reddit] getTickerRedditPosts ${ticker} failed: ${(err as any)?.message || err}`);
    return [];
  }
}

/**
 * Fetch trending finance posts from Reddit (general market sentiment).
 * Useful when markets are closed — captures weekend/holiday sentiment.
 */
export async function getFinanceRedditPosts(limit = 15): Promise<RedditPost[]> {
  const cacheKey = 'reddit:finance_trending';
  const cached = await cacheGet<RedditPost[]>(cacheKey);
  if (cached) return cached;

  const allPosts: RedditPost[] = [];

  // Fetch from top finance subs in parallel
  const results = await Promise.allSettled(
    FINANCE_SUBS.map(async (sub) => {
      try {
        const response = await axios.get(`${BASE}/r/${sub}/hot.json`, {
          params: { limit: 5 },
          headers: {
            'User-Agent': 'TradeIA/1.0 (trading bot)',
            Accept: 'application/json',
          },
          timeout: 10_000,
          validateStatus: () => true,
        });

        if (response.status !== 200) return [];
        return (response.data?.data?.children || [])
          .map((child: any) => child?.data)
          .filter((p: any) => p && p.title)
          .map((p: any) => ({
            title: p.title?.slice(0, 300) || '',
            selftext: p.selftext?.slice(0, 500) || '',
            author: p.author || 'unknown',
            created_utc: p.created_utc || 0,
            score: p.score || 0,
            num_comments: p.num_comments || 0,
            sentiment_hint: detectSentiment(`${p.title} ${p.selftext}`),
            subreddit: p.subreddit || sub,
            url: `https://reddit.com${p.permalink || ''}`,
          })) as RedditPost[];
      } catch {
        return [];
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allPosts.push(...result.value);
    }
  }

  // Sort by score, take top limit
  allPosts.sort((a, b) => b.score - a.score);
  const posts = allPosts.slice(0, limit);

  await cacheSet(cacheKey, posts, TTL.MARKET_CONTEXT);
  return posts;
}