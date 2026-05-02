import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';

export interface NewsItem {
  title: string;
  description: string;
  url: string;
  source: string;
  published_at: string;
  sentiment_hint: 'bullish' | 'bearish' | 'neutral';
  tickers: string[];
}

const FINANCE_RSS_FEEDS = [
  // CNBC US Top News & Markets
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114',
  // CNBC Market News
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069',
  // CNBC Earnings
  'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135',
];

const TICKER_REGEX = /\b([A-Z]{1,5})\b/g;
const KNOWN_TICKERS = new Set([
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'TSLA', 'META', 'AVGO', 'ADSK',
  'ABNB', 'ADBE', 'ADI', 'ADP', 'NFLX', 'AMD', 'INTC', 'CRM', 'PYPL', 'QCOM',
  'SPY', 'QQQ', 'IWM', 'DIA', 'XLF', 'XLE', 'XLK', 'XLV', 'XLY', 'XLI',
  'GS', 'JPM', 'BAC', 'WFC', 'V', 'MA', 'DIS', 'BA', 'UNH', 'JNJ',
  'KO', 'PEP', 'MCD', 'SBUX', 'NKE', 'COST', 'WMT', 'TGT', 'HD', 'LOW',
]);

function detectSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
  const lower = text.toLowerCase();
  const bullishWords = ['rally', 'gain', 'rise', 'surge', 'beat', 'upgrade', 'growth', 'bullish', 'buy', 'breakout', 'record', 'upside', 'soar', 'jump'];
  const bearishWords = ['crash', 'selloff', 'drop', 'fall', 'miss', 'downgrade', 'recession', 'bearish', 'sell', 'risk', 'fear', 'dive', 'loss', 'slump', 'tumble'];

  let bull = 0, bear = 0;
  for (const w of bullishWords) if (lower.includes(w)) bull++;
  for (const w of bearishWords) if (lower.includes(w)) bear++;

  if (bull > bear + 1) return 'bullish';
  if (bear > bull + 1) return 'bearish';
  return 'neutral';
}

function extractTickers(text: string): string[] {
  const matches = text.match(TICKER_REGEX) || [];
  return [...new Set(matches.filter(m => KNOWN_TICKERS.has(m)))];
}

function parseXMLItems(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      || block.match(/<title>(.*?)<\/title>/)?.[1] || '';
    const desc = block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1]
      || block.match(/<description>(.*?)<\/description>/)?.[1] || '';
    const link = block.match(/<link>(.*?)<\/link>/)?.[1] || '';
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';

    if (!title) continue;

    const fullText = `${title} ${desc}`;
    items.push({
      title: title.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
      description: desc.replace(/&amp;/g, '&').replace(/&apos;/g, "'").slice(0, 300),
      url: link,
      source,
      published_at: pubDate,
      sentiment_hint: detectSentiment(fullText),
      tickers: extractTickers(fullText),
    });
  }

  return items;
}

/**
 * Fetch fresh financial news from multiple RSS feeds.
 * Combines CNBC, Google News, and other free sources.
 * No API key required.
 */
export async function getFinanceNews(limit = 20): Promise<NewsItem[]> {
  const cacheKey = 'news:finance_rss';
  const cached = await cacheGet<NewsItem[]>(cacheKey);
  if (cached) return cached;

  const allItems: NewsItem[] = [];

  const results = await Promise.allSettled([
    // CNBC RSS feeds
    ...FINANCE_RSS_FEEDS.map(async (url) => {
      try {
        const response = await axios.get(url, {
          timeout: 8_000,
          validateStatus: () => true,
          headers: { 'User-Agent': 'TradeIA/1.0' },
        });
        if (response.status !== 200) return [];
        return parseXMLItems(response.data, 'CNBC');
      } catch { return []; }
    }),
    // Google News: market + earnings + NASDAQ
    axios.get('https://news.google.com/rss/search?q=NASDAQ+stock+market+earnings+breakout&hl=en-US&gl=US&ceid=US:en', {
      timeout: 8_000,
      validateStatus: () => true,
      headers: { 'User-Agent': 'TradeIA/1.0' },
    }).then((response) => {
      if (response.status !== 200) return [];
      return parseXMLItems(response.data, 'GoogleNews');
    }).catch(() => []),
  ]);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const items = result.value;
      if (Array.isArray(items)) allItems.push(...items);
    }
  }

  // Deduplicate by title, sort by date, take top limit
  const seen = new Set<string>();
  const unique = allItems.filter((item) => {
    const key = item.title.slice(0, 60).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
  const items = unique.slice(0, limit);

  await cacheSet(cacheKey, items, TTL.NEWS);
  return items;
}

/**
 * Fetch news specific to a ticker using Google News RSS.
 * No API key required.
 */
export async function getTickerNewsRSS(ticker: string, limit = 10): Promise<NewsItem[]> {
  const cacheKey = `news:ticker_rss:${ticker}`;
  const cached = await cacheGet<NewsItem[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(
      `https://news.google.com/rss/search?q=${encodeURIComponent(ticker)}+stock+earnings+OR+revenue+OR+guidance&hl=en-US&gl=US&ceid=US:en`,
      {
        timeout: 8_000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'TradeIA/1.0' },
      }
    );

    if (response.status !== 200) return [];

    const items = parseXMLItems(response.data, 'GoogleNews')
      .filter((item) => item.tickers.includes(ticker) || item.title.toUpperCase().includes(ticker))
      .slice(0, limit);

    await cacheSet(cacheKey, items, TTL.NEWS);
    return items;
  } catch {
    return [];
  }
}