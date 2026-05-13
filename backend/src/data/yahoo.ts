import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';
import type { OHLCVBar } from './indicators';
import { getTwelveDataCurrentPrice, getTwelveDataOHLCV } from './twelve-data';

export interface Fundamentals {
  pe: number | null;
  eps: number | null;
  revenue_growth: number | null;
  debt_equity: number | null;
  earnings_date: string | null;
  next_earnings_date: string | null; // prochaine publication de résultats (ISO)
  market_cap: number | null;
}

const BASE = 'https://query2.finance.yahoo.com/v8/finance/chart';
const BASE_Q1 = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SUMMARY = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** Tickers where Yahoo Finance symbol differs from the exchange:base convention */
const YAHOO_OVERRIDE: Record<string, string> = {
  'NOVOB:XCSE': 'NOVO-B.CO',   // Novo Nordisk B — Yahoo uses hyphen
  'EOAN:XETR':  'EOAN.DE',     // E.ON AG — explicit (just in case)
};

function unixToISO(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

// Session cookies + crumb — Yahoo requires both for reliable EU data
let cachedCrumb: string | null = null;
let cachedCookies = '';
let sessionExpiry = 0;
let sessionLogged = false;

async function getYahooSession(): Promise<{ crumb: string | null; cookies: string }> {
  if (cachedCrumb && Date.now() < sessionExpiry) return { crumb: cachedCrumb, cookies: cachedCookies };

  // Strategy: try query2 crumb endpoint directly (avoids GDPR consent redirect for EU servers)
  // If that fails, try with finance.yahoo.com home cookies
  try {
    for (const crumbUrl of [
      'https://query2.finance.yahoo.com/v1/test/getcrumb',
      'https://query1.finance.yahoo.com/v1/test/getcrumb',
    ]) {
      try {
        const crumbRes = await axios.get(crumbUrl, {
          headers: { ...YAHOO_HEADERS, ...(cachedCookies ? { Cookie: cachedCookies } : {}) },
          timeout: 8_000,
          validateStatus: () => true,
        });

        // Also capture any cookies set by the crumb endpoint itself
        const setCookieArr: string[] = (crumbRes.headers['set-cookie'] as string[] | undefined) ?? [];
        if (setCookieArr.length > 0 && !cachedCookies) {
          cachedCookies = setCookieArr.map((c) => c.split(';')[0]).join('; ');
        }

        if (typeof crumbRes.data === 'string' && crumbRes.data.length > 4) {
          cachedCrumb = crumbRes.data.trim();
          sessionExpiry = Date.now() + 3_600_000;
          if (!sessionLogged) {
            console.log(`[Yahoo] Crumb obtained from ${crumbUrl.includes('query2') ? 'query2' : 'query1'}`);
            sessionLogged = true;
          }
          break;
        }
      } catch {
        // try next endpoint
      }
    }
  } catch {
    // ignore
  }

  if (!cachedCrumb && !sessionLogged) {
    console.warn('[Yahoo] Could not obtain crumb — proceeding without auth (EU tickers may 404)');
    sessionLogged = true;
  }

  return { crumb: cachedCrumb, cookies: cachedCookies };
}

function buildYahooHeaders(cookies: string): Record<string, string> {
  return cookies ? { ...YAHOO_HEADERS, Cookie: cookies } : { ...YAHOO_HEADERS };
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

/** Aggregate 1h bars into 4h bars (open of first, high/low of group, close of last) */
function aggregate1hTo4h(bars: OHLCVBar[]): OHLCVBar[] {
  const result: OHLCVBar[] = [];
  for (let i = 0; i < bars.length; i += 4) {
    const group = bars.slice(i, Math.min(i + 4, bars.length));
    if (group.length === 0) continue;
    result.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((b) => b.high)),
      low: Math.min(...group.map((b) => b.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, b) => sum + b.volume, 0),
    });
  }
  return result;
}

export async function getYahooOHLCV(ticker: string, interval: '15m' | '1h' | '4h' | '1d', range: string = '1mo'): Promise<OHLCVBar[]> {
  const cacheKey = `yahoo:ohlcv:${ticker}:${interval}`;
  const cached = await cacheGet<OHLCVBar[]>(cacheKey);
  if (cached) return cached;

  try {
    // 4h: Yahoo doesn't support it natively — fetch 3 months of 1h bars and aggregate
    // This gives proper EMA-9/21/50 on a 4-hour timeframe (not on 1h masquerading as 4h)
    if (interval === '4h') {
      const bars1h = await getYahooOHLCV(ticker, '1h', '3mo');
      const bars4h = aggregate1hTo4h(bars1h);
      await cacheSet(cacheKey, bars4h, TTL.OHLCV);
      return bars4h;
    }

    const yahooInterval = interval;
    const yahooRange = interval === '15m' ? '5d' : range;

    const { crumb, cookies } = await getYahooSession();
    const params: Record<string, string> = { interval: yahooInterval, range: yahooRange };
    if (crumb) params.crumb = crumb;

    const response = await axios.get(`${BASE}/${ticker}`, {
      params,
      headers: buildYahooHeaders(cookies),
      timeout: 15_000,
      validateStatus: () => true,
    });

    if (response.status === 401 || response.status === 404) {
      // query2 failed — retry with query1 for EU tickers
      if (ticker.includes('.')) {
        const q1Res = await axios.get(`${BASE_Q1}/${ticker}`, {
          params,
          headers: buildYahooHeaders(cookies),
          timeout: 15_000,
          validateStatus: () => true,
        });
        if (q1Res.status === 200) {
          const r2: YahooChartResult = q1Res.data?.chart?.result?.[0];
          if (r2?.timestamp && r2?.indicators?.quote?.[0]) {
            const q2 = r2.indicators.quote[0];
            const bars2: OHLCVBar[] = [];
            for (let i = 0; i < r2.timestamp!.length; i++) {
              const o = q2.open?.[i]; const h = q2.high?.[i]; const l = q2.low?.[i]; const c = q2.close?.[i];
              if (o != null && h != null && l != null && c != null) bars2.push({ time: unixToISO(r2.timestamp![i]), open: o, high: h, low: l, close: c, volume: q2.volume?.[i] ?? 0 });
            }
            if (bars2.length > 0) {
              await cacheSet(cacheKey, bars2, interval === '15m' ? TTL.OHLCV : TTL.FUNDAMENTALS);
              return bars2;
            }
          }
        }
      }
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
    const { crumb, cookies } = await getYahooSession();
    const params: Record<string, string> = { interval: '1d', range: '1d' };
    if (crumb) params.crumb = crumb;

    const response = await axios.get(`${BASE}/${ticker}`, {
      params,
      headers: buildYahooHeaders(cookies),
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
    pe: null, eps: null, revenue_growth: null, debt_equity: null, earnings_date: null, next_earnings_date: null, market_cap: null,
  };

  // Try quoteSummary with crumb first
  const { crumb, cookies } = await getYahooSession();
  if (crumb) {
    try {
      const params: Record<string, string> = { modules: 'defaultKeyStatistics,financialData,earnings,calendarEvents', crumb };
      const response = await axios.get(`${SUMMARY}/${ticker}`, {
        params,
        headers: buildYahooHeaders(cookies),
        timeout: 15_000,
        validateStatus: () => true,
      });

      if (response.status === 200) {
        const stats = response.data?.quoteSummary?.result?.[0];
        if (stats) {
          const earningsTs: number | undefined = stats.calendarEvents?.earnings?.earningsDate?.[0]?.raw;
          const nextEarningsDate = earningsTs ? new Date(earningsTs * 1000).toISOString() : null;
          const result: Fundamentals = {
            pe: stats.defaultKeyStatistics?.forwardPE?.raw ?? null,
            eps: stats.defaultKeyStatistics?.trailingEps?.raw ?? null,
            revenue_growth: stats.financialData?.revenueGrowth?.raw ?? null,
            debt_equity: stats.financialData?.debtToEquity ?? null,
            earnings_date: stats.earnings?.financialsChart?.quarterly?.[0]?.date ?? null,
            next_earnings_date: nextEarningsDate,
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
      headers: buildYahooHeaders(cookies),
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
      next_earnings_date: null,
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
    const { crumb, cookies } = await getYahooSession();
    const params: Record<string, string> = { interval: '1d', range: '5d' };
    if (crumb) params.crumb = crumb;

    const response = await axios.get(`${BASE}/%5EVIX`, {
      params,
      headers: buildYahooHeaders(cookies),
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
    const { crumb, cookies } = await getYahooSession();
    const params: Record<string, string> = { interval: '1d', range: '5d' };
    if (crumb) params.crumb = crumb;

    const response = await axios.get(`${BASE}/QQQ`, {
      params,
      headers: buildYahooHeaders(cookies),
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

export async function getMarketContext(): Promise<{ vix: number; fear_greed: number; nasdaq_direction: string; nasdaq_change_pct: number }> {
  try {
    const vix = await getYahooCurrentPrice('^VIX') || 20;
    const { direction, change_pct } = await getNasdaqDirection();
    return {
      vix,
      fear_greed: vix > 25 ? 20 : vix < 15 ? 80 : 50,
      nasdaq_direction: direction,
      nasdaq_change_pct: change_pct,
    };
  } catch {
    return { vix: 20, fear_greed: 50, nasdaq_direction: 'neutral', nasdaq_change_pct: 0 };
  }
}

/**
 * Equity data routing: Yahoo first (free, no rate limit), Twelve Data only as fallback.
 *
 * Twelve Data has a strict daily credit limit (800 on free tier). Calling it as primary
 * exhausts credits within hours. Yahoo's v8 chart endpoint is unmetered for our usage
 * and works for both US and EU listings (via .DE/.PA/.L suffix conversion).
 *
 * Twelve Data is reserved for tickers Yahoo can't resolve.
 */
export async function getEquityOHLCV(ticker: string, interval: '15m' | '1h' | '4h' | '1d'): Promise<OHLCVBar[]> {
  const yahooSym = toYahooSymbol(ticker);
  const yahooBars = await getYahooOHLCV(yahooSym, interval);
  if (yahooBars.length > 0) return yahooBars;
  return getTwelveDataOHLCV(ticker, interval);
}

export async function getEquityCurrentPrice(ticker: string): Promise<number | null> {
  const yahooSym = toYahooSymbol(ticker);
  const yahooPrice = await getYahooCurrentPrice(yahooSym);
  if (yahooPrice !== null) return yahooPrice;
  return getTwelveDataCurrentPrice(ticker);
}

/** Convert internal exchange:symbol to Yahoo Finance symbol */
export function toYahooSymbol(ticker: string): string {
  if (YAHOO_OVERRIDE[ticker]) return YAHOO_OVERRIDE[ticker];
  if (!ticker.includes(':')) return ticker;
  const [sym, exchange] = ticker.split(':');
  const suffix: Record<string, string> = {
    XETR: '.DE', XPAR: '.PA', LSE: '.L', XSWX: '.SW',
    XAMS: '.AS', XCSE: '.CO', XMAD: '.MC', XMIL: '.MI', XHEL: '.HE',
  };
  return sym + (suffix[exchange] ?? `.${exchange}`);
}

const TTL_SNAPSHOT = 15 * 60; // 15 minutes
const SNAPSHOT_BATCH = 20;   // parallel requests per round

export interface TickerSnapshotResult {
  ticker: string;
  name: string | null;
  price: number | null;
  change_1d_pct: number | null;
  volume: number | null;
}

async function fetchOneTicker(ticker: string, crumb: string | null, cookies: string): Promise<TickerSnapshotResult> {
  const yahooSym = toYahooSymbol(ticker);
  try {
    const params: Record<string, string> = { interval: '1d', range: '5d' };
    if (crumb) params.crumb = crumb;

    const response = await axios.get(`${BASE}/${encodeURIComponent(yahooSym)}`, {
      params,
      headers: buildYahooHeaders(cookies),
      timeout: 12_000,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      return { ticker, name: null, price: null, change_1d_pct: null, volume: null };
    }

    const result = response.data?.chart?.result?.[0];
    if (!result) return { ticker, name: null, price: null, change_1d_pct: null, volume: null };

    const meta = result.meta ?? {};
    const price: number | null = meta.regularMarketPrice ?? null;
    const prevClose: number | null = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change_1d_pct =
      price !== null && prevClose !== null && prevClose !== 0
        ? ((price - prevClose) / prevClose) * 100
        : null;

    const volumes: (number | null)[] = result.indicators?.quote?.[0]?.volume ?? [];
    const lastVol = [...volumes].reverse().find((v): v is number => v !== null) ?? null;

    return {
      ticker,
      name: meta.shortName ?? meta.longName ?? null,
      price,
      change_1d_pct,
      volume: lastVol,
    };
  } catch {
    return { ticker, name: null, price: null, change_1d_pct: null, volume: null };
  }
}

/** Batch fetch snapshot (price + 1d change % + company name) for a list of tickers */
export async function getTickerSnapshots(tickers: string[]): Promise<TickerSnapshotResult[]> {
  if (tickers.length === 0) return [];

  const { createHash } = await import('crypto');
  const hash = createHash('md5').update([...tickers].sort().join(',')).digest('hex');
  const cacheKey = `snapshot4:${hash}`;

  const cached = await cacheGet<TickerSnapshotResult[]>(cacheKey);
  if (cached) {
    console.log(`[Yahoo] getTickerSnapshots: cache hit (${tickers.length} tickers)`);
    return cached;
  }

  console.log(`[Yahoo] getTickerSnapshots: fetching ${tickers.length} tickers in batches of ${SNAPSHOT_BATCH}`);
  const { crumb, cookies } = await getYahooSession();
  const results: TickerSnapshotResult[] = [];

  for (let i = 0; i < tickers.length; i += SNAPSHOT_BATCH) {
    const batch = tickers.slice(i, i + SNAPSHOT_BATCH);
    const batchResults = await Promise.all(batch.map((t) => fetchOneTicker(t, crumb, cookies)));
    results.push(...batchResults);
  }

  const fetched = results.filter((r) => r.price !== null).length;
  console.log(`[Yahoo] getTickerSnapshots: ${fetched}/${tickers.length} tickers with prices`);

  await cacheSet(cacheKey, results, TTL_SNAPSHOT);
  return results;
}
