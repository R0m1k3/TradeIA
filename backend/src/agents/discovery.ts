import { getMarketSnapshot } from '../data/polygon';
import { callLLM, parseJsonResponse } from '../llm/client';
import { MODELS } from '../llm/models';

const DISCOVERY_SYSTEM = `You are a Master Market Scanner. 
Your goal is to analyze a list of top market movers and select the most promising tickers for an algorithmic trading strategy.
Focus on:
1. High relative volume (unusual activity).
2. Clean price action (avoiding penny stocks or extremely illiquid assets).
3. Stocks with clear momentum or reversal patterns.

Return ONLY a JSON array of 5 to 10 ticker symbols. Example: ["AAPL", "NVDA", "TSLA"]`;

export class DiscoveryAgent {
  async run(): Promise<string[]> {
    console.log('[Discovery] Scanning global market...');
    
    try {
      const snapshot = await getMarketSnapshot();
      if (!snapshot || snapshot.length === 0) {
        console.warn('[Discovery] No market data available, using fallback watchlist');
        return [];
      }

      // Pre-filter: Focus on stocks with price > $5 and significant volume
      const candidates = snapshot
        .filter((s: any) => s.day?.v > 500000 && s.min?.c > 5)
        .sort((a: any) => Math.abs(a.todaysChangePerc || 0))
        .reverse()
        .slice(0, 50);

      if (candidates.length === 0) return [];

      const input = candidates.map((c: any) => ({
        ticker: c.ticker,
        price: c.min?.c,
        change: c.todaysChangePerc?.toFixed(2) + '%',
        volume: c.day?.v
      }));

      const prompt = `Analyze these 50 top movers and pick the 10 most interesting for a long/short day-trading strategy:
      ${JSON.stringify(input)}`;

      try {
        const response = await callLLM('discovery', MODELS.LIGHT, DISCOVERY_SYSTEM, prompt);
        const selectedTickers = parseJsonResponse<string[]>(response.content);
        
        console.log(`[Discovery] IA selected: ${selectedTickers.join(', ')}`);
        return selectedTickers;
      } catch (err) {
        console.error('[Discovery] IA Selection failed, using top 10 by volume:', err);
        return candidates.slice(0, 10).map((c: any) => c.ticker);
      }
    } catch (err) {
      console.error('[Discovery] Fatal error:', err);
      return [];
    }
  }
}
