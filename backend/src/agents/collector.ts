import { getEquityOHLCV, getEquityCurrentPrice, getYahooFundamentals } from '../data/yahoo';
import { getTradingViewSignal, type TradingViewSignal } from '../data/tradingview';
import { getFinvizMacro, type FinvizMacro } from '../data/finviz';
import { getMarketInternals, type MarketInternals } from '../data/market-internals';
import { computeIndicators, type IndicatorValues } from '../data/indicators';
import { getMacroData, type MacroData } from '../data/fred';
import { getSectorBiases, getTickerSector, type SectorBias } from '../data/sectors';
import { getFinanceNews, getTickerNewsRSS, type NewsItem } from '../data/news-rss';
import { getMarketContext } from '../data/yahoo';
import { getEUIndexDirection, type EUIndexData } from '../data/european-markets';
import { getCredential } from '../config/credentials';
import { latestObservedAt, sourceFreshness, summarizeFreshness, type DataQualitySummary } from '../data/freshness';

export interface TickerData {
  data_quality: 'ok' | 'stale' | 'partial' | 'missing';
  sector?: string;
  current_price: number;
  ohlcv_15m: unknown[];
  ohlcv_1h: unknown[];
  ohlcv_4h: unknown[];
  fundamentals: unknown;
  news: unknown[];
  indicators: IndicatorValues | null;
  tradingview: TradingViewSignal;
  earnings_blackout?: boolean;
  options?: { iv30?: number | null };
  data_freshness: DataQualitySummary;
}

export interface CollectorOutput {
  tickers: Record<string, TickerData>;
  market: {
    vix: number;
    fear_greed: number;
    nasdaq_direction: string;
    nasdaq_change_pct: number;
    macro: MacroData;
    finviz: FinvizMacro;
    internals: MarketInternals;
    sector_biases: Record<string, SectorBias>;
    eu: EUIndexData;
    data_freshness: DataQualitySummary;
  };
  finance_rss_news: NewsItem[];
  collected_at: string;
}

function resolve<T>(promise: PromiseSettledResult<T>, fallback: T): T {
  return promise.status === 'fulfilled' ? promise.value : fallback;
}

export class CollectorAgent {
  async run(watchlist: string[]): Promise<CollectorOutput | null> {
    console.log(`[Collector] Fetching data for ${watchlist.length} assets...`);

    try {
      const polygonKey = await getCredential('polygon_key', 'POLYGON_KEY');
      const twelveDataKey = await getCredential('twelve_data_key', 'TWELVE_DATA_KEY');
      const eodhdKey = await getCredential('eodhd_key', 'EODHD_KEY');

      const [macro, sectorBiases, financeRSS, finvizMacro, internals, marketContext, euData] = await Promise.all([
        getMacroData(),
        getSectorBiases(),
        getFinanceNews(),
        getFinvizMacro(),
        getMarketInternals(),
        getMarketContext(),
        getEUIndexDirection(),
      ]);

      console.log(`[Collector] Macro: ${macro.summary}`);

      const rawData: Record<string, unknown> = {};

      for (let i = 0; i < watchlist.length; i += 10) {
        const chunk = watchlist.slice(i, i + 10);
        await Promise.all(
          chunk.map(async (ticker) => {
            try {
              const [ohlcv15m, ohlcv1h, ohlcv4h, price, fundamentals, news, tvSignal] = await Promise.allSettled([
                getEquityOHLCV(ticker, '15m'),
                getEquityOHLCV(ticker, '1h'),
                getEquityOHLCV(ticker, '4h'),
                getEquityCurrentPrice(ticker),
                getYahooFundamentals(ticker),
                getTickerNewsRSS(ticker, 10),
                getTradingViewSignal(ticker),
              ]);

              const bars_15m = resolve(ohlcv15m, []);
              const bars_1h = resolve(ohlcv1h, []);
              const bars_4h = resolve(ohlcv4h, []);
              const p = resolve(price, null);
              const funds = resolve(fundamentals, null);
              const newsData = resolve(news, []);
              const tv = resolve(tvSignal, { recommendation: 'UNKNOWN', score: 0 });

              const indicators = computeIndicators(
                bars_15m as any[],
                bars_1h as any[],
                bars_4h as any[],
              );

              const sector = getTickerSector(ticker);

              let quality: 'ok' | 'stale' | 'partial' | 'missing' = 'ok';
              if (!p || bars_15m.length === 0) quality = 'missing';
              else if (bars_15m.length < 50) quality = 'partial';

              const dataFreshness = summarizeFreshness([
                sourceFreshness(
                  'Yahoo Finance',
                  p ? 'delayed' : 'missing',
                  'Données actions gratuites susceptibles d\'être retardées ou incomplètes.',
                  latestObservedAt(bars_15m as unknown[])
                ),
                sourceFreshness(
                  'TradingView scanner',
                  tv.recommendation === 'UNKNOWN' ? 'missing' : 'fresh',
                  tv.recommendation === 'UNKNOWN'
                    ? 'Signal TradingView indisponible pour ce ticker.'
                    : `Signal technique ${tv.recommendation}.`
                ),
                sourceFreshness(
                  'Google News/RSS',
                  newsData.length > 0 ? 'fresh' : 'missing',
                  newsData.length > 0
                    ? `${newsData.length} news récentes trouvées.`
                    : 'Aucune news récente exploitable trouvée.'
                ),
                sourceFreshness(
                  'Twelve Data',
                  twelveDataKey ? 'fresh' : 'missing',
                  twelveDataKey
                    ? 'Clé configurée, source API prioritaire pour prix et bougies actions.'
                    : 'Clé Twelve Data absente, fallback Yahoo utilisé.'
                ),
                sourceFreshness(
                  'Polygon.io',
                  polygonKey ? 'limited' : 'missing',
                  polygonKey
                    ? 'Clé configurée, plan FREE traité comme source complémentaire limitée/différée.'
                    : 'Clé Polygon absente, actions analysées sans cette source.'
                ),
                sourceFreshness(
                  'EODHD',
                  eodhdKey ? 'fresh' : 'missing',
                  eodhdKey
                    ? 'Clé configurée, données historiques et fondamentales européennes disponibles.'
                    : 'Clé EODHD absente, données européennes limitées à Twelve Data + Yahoo.'
                ),
              ], [
                'Actions: les sources gratuites peuvent être différées, la confiance doit en tenir compte.',
              ]);

              rawData[ticker] = {
                data_quality: quality,
                sector,
                current_price: p || 0,
                ohlcv_15m: bars_15m,
                ohlcv_1h: bars_1h,
                ohlcv_4h: bars_4h,
                fundamentals: funds,
                news: newsData,
                indicators,
                tradingview: tv,
                earnings_blackout: false,
                options: {},
                data_freshness: dataFreshness,
              };
            } catch (err) {
              console.error(`[Collector] Failed to fetch ${ticker}:`, err);
              rawData[ticker] = {
                data_quality: 'missing',
                current_price: 0,
                ohlcv_15m: [],
                ohlcv_1h: [],
                ohlcv_4h: [],
                fundamentals: {},
                news: [],
                indicators: null,
                tradingview: { recommendation: 'UNKNOWN', score: 0 },
                earnings_blackout: false,
                options: {},
                data_freshness: summarizeFreshness([
                  sourceFreshness('Collector', 'missing', `Collecte échouée: ${(err as Error).message}`),
                ]),
              };
            }
          })
        );
      }

      console.log('[Collector] Skipping LLM — using locally structured data with indicators');
      return {
        tickers: rawData as Record<string, TickerData>,
        market: {
          vix: marketContext.vix,
          fear_greed: marketContext.fear_greed,
          nasdaq_direction: marketContext.nasdaq_direction,
          nasdaq_change_pct: marketContext.nasdaq_change_pct,
          macro,
          finviz: finvizMacro,
          internals,
          sector_biases: sectorBiases,
          eu: euData,
          data_freshness: summarizeFreshness([
            sourceFreshness('Yahoo Finance', marketContext.vix > 0 ? 'delayed' : 'missing', 'VIX et direction Nasdaq via sources gratuites.'),
            sourceFreshness('Twelve Data', twelveDataKey ? 'fresh' : 'missing', twelveDataKey ? 'Clé configurée pour prix/bougies actions.' : 'Clé absente, fallback Yahoo.'),
            sourceFreshness('FRED', macro.fed_funds_rate !== null || macro.yield_curve !== null ? 'fresh' : 'limited', macro.summary),
            sourceFreshness('RSS News', financeRSS.length > 0 ? 'fresh' : 'missing', `${financeRSS.length} news macro collectées.`),
            sourceFreshness('Polygon.io', polygonKey ? 'limited' : 'missing', polygonKey ? 'Plan FREE configuré, utilisé comme appoint limité.' : 'Clé Polygon absente.'),
            sourceFreshness('Indices EU', euData.cac40_change_pct !== 0 || euData.dax_change_pct !== 0 ? 'fresh' : 'limited', 'CAC 40, DAX, FTSE 100 via Twelve Data / Yahoo.'),
            sourceFreshness('EODHD', eodhdKey ? 'fresh' : 'missing', eodhdKey ? 'Clé configurée, données européennes historiques disponibles.' : 'Clé EODHD absente.'),
          ], [
            'La qualité marché combine prix, macro, news, indices EU et disponibilité des sources.',
          ]),
        },
        finance_rss_news: financeRSS,
        collected_at: new Date().toISOString(),
      };
    } catch (err) {
      console.error('[Collector] Fatal error:', err);
      return null;
    }
  }
}