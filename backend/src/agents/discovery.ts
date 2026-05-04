import { getMarketSnapshot } from '../data/polygon';
import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { getCredential } from '../config/credentials';
import axios from 'axios';

const DISCOVERY_SYSTEM = `You are a Master Market Scanner for medium-term swing trading (5-20 day holds).
Your goal is to analyze a list of top market movers and select the most promising tickers for a medium-term swing trading strategy.
Transaction costs (~0.1-0.5% per trade) make short-term scalping unprofitable — focus on moves of 3%+.
Focus on:
1. Stocks with clear medium-term trend alignment (4H/daily trend direction).
2. High relative volume confirming institutional interest.
3. Clean price action with identifiable S/R levels (avoid penny stocks or extremely illiquid assets).
4. Stocks approaching key technical levels (breakouts, pullbacks to moving averages).

Return ONLY a JSON array of 5 to 15 ticker symbols. Example: ["AAPL", "NVDA", "TSLA"]`;

/** NASDAQ 100 fallback tickers (full list) */
const NASDAQ_100 = [
  'AAPL', 'ABNB', 'ADBE', 'ADI', 'ADP', 'ADSK', 'AEP', 'AMGN', 'AMZN', 'ANSS',
  'ARM', 'ASML', 'AVGO', 'AXON', 'AZN', 'BIIB', 'BKNG', 'BKR', 'CDNS', 'CDW',
  'CEG', 'CHTR', 'CMCSA', 'COIN', 'COST', 'CPRT', 'CRWD', 'CTAS', 'CTSH', 'DASH',
  'DDOG', 'DLTR', 'DXCM', 'EA', 'EXC', 'FANG', 'FAST', 'FTNT', 'GE', 'GILD',
  'GOOGL', 'HON', 'IDXX', 'ILMN', 'INTC', 'INTU', 'ISRG', 'KDP', 'KHC', 'KLAC',
  'LRCX', 'LULU', 'MAR', 'MCHP', 'MDB', 'MDLZ', 'MELI', 'META', 'MNST', 'MRVL',
  'MSFT', 'MU', 'NFLX', 'NVDA', 'NXPI', 'ODFL', 'ON', 'ORCL', 'PANW', 'PAYX',
  'PCAR', 'PDD', 'PEP', 'PLTR', 'PYPL', 'QCOM', 'REGN', 'ROP', 'ROST', 'SBUX',
  'SNPS', 'TEAM', 'TMUS', 'TSLA', 'TTD', 'TTWO', 'TXN', 'VRTX', 'VRSK', 'VRSN',
  'WBD', 'WDAY', 'XEL', 'ZS',
];

export class DiscoveryAgent {
  async run(): Promise<string[]> {
    console.log('[Discovery] Scanning global market...');

    // Try Polygon market snapshot
    const snapshot = await getMarketSnapshot();
    if (snapshot && snapshot.length > 0) {
      const candidates = snapshot
        .filter((s: any) => s.day?.v > 500000 && s.min?.c > 5)
        .sort((a: any, b: any) => Math.abs(b.todaysChangePerc || 0) - Math.abs(a.todaysChangePerc || 0))
        .slice(0, 50);

      if (candidates.length > 0) {
        const input = candidates.map((c: any) => ({
          ticker: c.ticker,
          price: c.min?.c,
          change: c.todaysChangePerc?.toFixed(2) + '%',
          volume: c.day?.v,
        }));

        const selected = await this.selectWithAI(JSON.stringify(input), candidates.map((c: any) => c.ticker));
        if (selected.length > 0) return selected;
      }
    }

    // Try Yahoo Finance screener
    console.log('[Discovery] Polygon unavailable, trying Yahoo Finance screener');
    const yahooTickers = await this.yahooScreener();
    if (yahooTickers.length > 0) {
      console.log(`[Discovery] Passing ${yahooTickers.length} Yahoo trending tickers to AI...`);
      const selected = await this.selectWithAI(JSON.stringify(yahooTickers), yahooTickers);
      if (selected.length > 0) return selected;
    }

    // Fallback to NASDAQ 100
    console.log('[Discovery] All sources unavailable, passing NASDAQ 100 fallback to AI');
    // Shuffle the array to give variety if LLM fails
    const shuffledNasdaq = [...NASDAQ_100].sort(() => 0.5 - Math.random());
    const selected = await this.selectWithAI(JSON.stringify(NASDAQ_100), shuffledNasdaq);
    return selected.length > 0 ? selected : shuffledNasdaq.slice(0, 15);
  }

  private async selectWithAI(candidatesInfo: string, fallbackCandidates: string[]): Promise<string[]> {
    const MODELS = await getModels();
    try {
      const response = await callLLM('discovery', MODELS.LIGHT, DISCOVERY_SYSTEM,
        `Analyze these candidates and pick the 10-15 most interesting for a long/short day-trading strategy:\n${candidatesInfo}`);
      const selectedTickers = parseJsonResponse<string[]>(response.content);
      console.log(`[Discovery] AI selected: ${selectedTickers.join(', ')}`);
      return selectedTickers;
    } catch (err) {
      console.warn('[Discovery] AI selection failed:', (err as Error).message);
      return fallbackCandidates.slice(0, 15);
    }
  }

  /** Yahoo Finance screener for top movers */
  private async yahooScreener(): Promise<string[]> {
    try {
      const response = await axios.get('https://query1.finance.yahoo.com/v1/finance/trending/US', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10_000,
      });

      const quotes = response.data?.finance?.result?.[0]?.quotes;
      if (quotes && quotes.length > 0) {
          const tickers = quotes.map((q: any) => q.symbol);
        console.log(`[Discovery] Yahoo trending: ${tickers.join(', ')}`);
        return tickers;
      }
    } catch (err) {
      console.warn('[Discovery] Yahoo screener failed:', (err as Error).message);
    }
    return [];
  }
}