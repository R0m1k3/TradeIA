import { callLLM, parseJsonResponse } from '../llm/client';
import { MODELS } from '../llm/models';
import { getIntraday, getDaily, getFundamentals, getCurrentPrice } from '../data/alphavantage';
import { getOptionsData, getDailyVolume } from '../data/polygon';
import { getTickerNews, getSentiment, getMarketContext } from '../data/finnhub';
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

export class CollectorAgent {
  async run(watchlist: string[]): Promise<CollectorOutput | null> {
    console.log(`[Collector] Fetching data for: ${watchlist.join(', ')}`);

    try {
      const market = await getMarketContext();
      const rawData: Record<string, unknown> = {};

      await Promise.all(
        watchlist.map(async (ticker) => {
          try {
            const [ohlcv_15m, ohlcv_1h, ohlcv_4h, fundamentals, options, news, sentiment, daily_volume, current_price] =
              await Promise.allSettled([
                getIntraday(ticker, '15min'),
                getIntraday(ticker, '60min'),
                getDaily(ticker),
                getFundamentals(ticker),
                getOptionsData(ticker),
                getTickerNews(ticker),
                getSentiment(ticker),
                getDailyVolume(ticker),
                getCurrentPrice(ticker),
              ]);

            const resolve = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
              r.status === 'fulfilled' ? r.value : fallback;

            const price = resolve(current_price as PromiseSettledResult<number | null>, null);
            const ohlcv15 = resolve(ohlcv_15m as PromiseSettledResult<unknown[]>, []);
            const ohlcv1h = resolve(ohlcv_1h as PromiseSettledResult<unknown[]>, []);
            const ohlcv4h = resolve(ohlcv_4h as PromiseSettledResult<unknown[]>, []);
            const funds = resolve(fundamentals as PromiseSettledResult<unknown>, {});
            const opts = resolve(options as PromiseSettledResult<unknown>, {});
            const newsData = resolve(news as PromiseSettledResult<unknown[]>, []);
            const sent = resolve(sentiment as PromiseSettledResult<unknown>, {});
            const vol = resolve(daily_volume as PromiseSettledResult<number | null>, null);

            const earningsDate = (funds as { earnings_date?: string | null }).earnings_date;
            const earningsBlackout = earningsDate
              ? Math.abs(new Date(earningsDate).getTime() - Date.now()) < 48 * 3600 * 1000
              : false;

            let quality: 'ok' | 'stale' | 'partial' | 'missing' = 'ok';
            if (!price || ohlcv15.length === 0) quality = 'missing';
            else if (ohlcv15.length < 50) quality = 'partial';

            rawData[ticker] = {
              data_quality: quality,
              earnings_blackout: earningsBlackout,
              current_price: price || 0,
              ohlcv_15m: ohlcv15,
              ohlcv_1h: ohlcv1h,
              ohlcv_4h: ohlcv4h,
              fundamentals: funds,
              options: opts,
              news: newsData,
              sentiment: sent,
              daily_volume: vol,
            };
          } catch (err) {
            console.error(`[Collector] Failed to fetch ${ticker}:`, err);
            rawData[ticker] = { data_quality: 'missing', earnings_blackout: false, current_price: 0 };
          }
        })
      );

      const prompt = buildCollectorPrompt({ tickers: watchlist, rawData, marketData: market });

      try {
        const response = await callLLM('collector', MODELS.LIGHT, COLLECTOR_SYSTEM, prompt);
        const parsed = parseJsonResponse<CollectorOutput>(response.content);
        return parsed;
      } catch (err) {
        console.warn('[Collector] LLM parsing failed, using raw data directly:', err);
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
