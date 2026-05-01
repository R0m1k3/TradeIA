import { callLLM, parseJsonResponse } from '../llm/client';
import { MODELS } from '../llm/models';
import { getIntraday, getDaily, getFundamentals, getCurrentPrice } from '../data/alphavantage';
import { getOptionsData, getDailyVolume } from '../data/polygon';
import { getTickerNews, getSentiment, getMarketContext } from '../data/finnhub';
import { getYahooOHLCV, getYahooCurrentPrice, getYahooFundamentals } from '../data/yahoo';
import { computeIndicators, compute4HBias, compute15mSignal, computeTradeType, computeLevels, type IndicatorValues } from '../data/indicators';
import { buildCollectorPrompt, COLLECTOR_SYSTEM } from '../prompts/collector.prompt';

export interface TickerData {
  data_quality: 'ok' | 'stale' | 'partial' | 'missing';
  earnings_blackout: boolean;
  current_price: number;
  ohlcv_15m: unknown[];
  ohlcv_1h: unknown[];
  ohlcv_4h: unknown[];
  fundamentals: unknown;
  options: unknown;
  news: unknown[];
  sentiment: unknown;
  daily_volume: number | null;
  indicators: IndicatorValues | null;
}

export interface CollectorOutput {
  tickers: Record<string, TickerData>;
  market: {
    vix: number;
    fear_greed: number;
    nasdaq_direction: string;
    fed_next_meeting: string;
  };
  collected_at: string;
}

function resolve<T>(promise: PromiseSettledResult<T>, fallback: T): T {
  return promise.status === 'fulfilled' ? promise.value : fallback;
}

/** Fetch OHLCV data with fallback: AlphaVantage → Yahoo Finance */
async function fetchOHLCV(ticker: string): Promise<{ bars_15m: unknown[]; bars_1h: unknown[]; bars_4h: unknown[] }> {
  // Try AlphaVantage first
  const [av15m, av1h, avDaily] = await Promise.allSettled([
    getIntraday(ticker, '15min'),
    getIntraday(ticker, '60min'),
    getDaily(ticker),
  ]);

  const bars_15m = resolve(av15m, []);
  const bars_1h = resolve(av1h, []);
  const bars_daily = resolve(avDaily, []);

  // If AlphaVantage gave us data, use it
  if (bars_15m.length > 20 && bars_1h.length > 10) {
    return { bars_15m, bars_1h, bars_4h: bars_daily };
  }

  // Fallback to Yahoo Finance
  console.log(`[Collector] AlphaVantage data insufficient for ${ticker}, trying Yahoo`);
  const [y15m, y1h, y4h] = await Promise.allSettled([
    getYahooOHLCV(ticker, '15m'),
    getYahooOHLCV(ticker, '1h'),
    getYahooOHLCV(ticker, '4h'),
  ]);

  const yahoo_15m = resolve(y15m, []);
  const yahoo_1h = resolve(y1h, []);
  const yahoo_4h = resolve(y4h, []);

  // Use Yahoo where AlphaVantage failed, prefer AlphaVantage where it worked
  return {
    bars_15m: bars_15m.length > yahoo_15m.length ? bars_15m : yahoo_15m,
    bars_1h: bars_1h.length > yahoo_1h.length ? bars_1h : yahoo_1h,
    bars_4h: bars_daily.length > yahoo_4h.length ? bars_daily : yahoo_4h,
  };
}

/** Fetch current price with fallback */
async function fetchPrice(ticker: string): Promise<number | null> {
  const [avPrice, yahooPrice] = await Promise.allSettled([
    getCurrentPrice(ticker),
    getYahooCurrentPrice(ticker),
  ]);

  const p1 = resolve(avPrice, null);
  const p2 = resolve(yahooPrice, null);
  return p1 ?? p2;
}

/** Fetch fundamentals with fallback */
async function fetchFundamentals(ticker: string): Promise<unknown> {
  const [avFund, yahooFund] = await Promise.allSettled([
    getFundamentals(ticker),
    getYahooFundamentals(ticker),
  ]);

  const f1 = resolve(avFund, null);
  const f2 = resolve(yahooFund, null);
  return f1 ?? f2 ?? {};
}

export class CollectorAgent {
  async run(watchlist: string[]): Promise<CollectorOutput | null> {
    console.log(`[Collector] Fetching data for: ${watchlist.join(', ')}`);

    try {
      const market = await getMarketContext();
      const rawData: Record<string, unknown> = {};

      await Promise.all(
        watchlist.map(async (ticker) => {
          try {
            const [ohlcvData, price, fundamentals, options, news, sentiment, daily_volume] =
              await Promise.allSettled([
                fetchOHLCV(ticker),
                fetchPrice(ticker),
                fetchFundamentals(ticker),
                getOptionsData(ticker),
                getTickerNews(ticker),
                getSentiment(ticker),
                getDailyVolume(ticker),
              ]);

            const bars_15m = resolve(ohlcvData, { bars_15m: [], bars_1h: [], bars_4h: [] } as any);
            const p = resolve(price, null);
            const funds = resolve(fundamentals, {});
            const opts = resolve(options, { put_call_ratio: null, iv30: null } as any);
            const newsData = resolve(news, []);
            const sent = resolve(sentiment, { sentiment_score: 0, buzz_score: 0 } as any);
            const vol = resolve(daily_volume, null);

            const ohlcv15 = (bars_15m as any).bars_15m || [];
            const ohlcv1h = (bars_15m as any).bars_1h || [];
            const ohlcv4h = (bars_15m as any).bars_4h || [];

            // Compute indicators locally from OHLCV data
            const indicators = computeIndicators(
              ohlcv15 as any[],
              ohlcv1h as any[],
              ohlcv4h as any[],
            );

            const earningsDate = (funds as { earnings_date?: string | null })?.earnings_date;
            const earningsBlackout = earningsDate
              ? Math.abs(new Date(earningsDate).getTime() - Date.now()) < 48 * 3600 * 1000
              : false;

            let quality: 'ok' | 'stale' | 'partial' | 'missing' = 'ok';
            if (!p || ohlcv15.length === 0) quality = 'missing';
            else if (ohlcv15.length < 50) quality = 'partial';

            rawData[ticker] = {
              data_quality: quality,
              earnings_blackout: earningsBlackout,
              current_price: p || 0,
              ohlcv_15m: ohlcv15,
              ohlcv_1h: ohlcv1h,
              ohlcv_4h: ohlcv4h,
              fundamentals: funds,
              options: opts,
              news: newsData,
              sentiment: sent,
              daily_volume: vol,
              indicators,
            };
          } catch (err) {
            console.error(`[Collector] Failed to fetch ${ticker}:`, err);
            rawData[ticker] = {
              data_quality: 'missing',
              earnings_blackout: false,
              current_price: 0,
              ohlcv_15m: [],
              ohlcv_1h: [],
              ohlcv_4h: [],
              fundamentals: {},
              options: {},
              news: [],
              sentiment: {},
              daily_volume: null,
              indicators: null,
            };
          }
        })
      );

      const prompt = buildCollectorPrompt({ tickers: watchlist, rawData, marketData: market });

      try {
        const response = await callLLM('collector', MODELS.LIGHT, COLLECTOR_SYSTEM, prompt);
        const parsed = parseJsonResponse<CollectorOutput>(response.content);
        // Merge locally-computed indicators into LLM output (LLM may miss things)
        for (const ticker of Object.keys(rawData)) {
          const localIndicators = (rawData[ticker] as any).indicators as IndicatorValues | null;
          if (localIndicators && parsed.tickers?.[ticker]) {
            parsed.tickers[ticker].indicators = localIndicators;
          }
        }
        return parsed;
      } catch (err) {
        console.warn('[Collector] LLM parsing failed, using raw data with local indicators:', err);
        return {
          tickers: rawData as Record<string, TickerData>,
          market: { vix: market.vix, fear_greed: market.fear_greed, nasdaq_direction: market.nasdaq_direction, fed_next_meeting: '' },
          collected_at: new Date().toISOString(),
        };
      }
    } catch (err) {
      console.error('[Collector] Fatal error:', err);
      return null;
    }
  }
}