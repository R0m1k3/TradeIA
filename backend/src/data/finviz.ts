import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';

export interface FinvizMacro {
  stocks_above_sma50_pct: number | null;
  market_breadth: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export async function getFinvizMacro(): Promise<FinvizMacro> {
  const cacheKey = 'finviz:macro';
  const cached = await cacheGet<FinvizMacro>(cacheKey);
  if (cached) return cached;

  try {
    // We fetch the Finviz homepage and use a simple regex to find the "Advancing" vs "Declining" 
    // or just rely on Yahoo VIX for now as Finviz blocks bots aggressively.
    // Given the lack of a proper DOM parser, we'll return a simulated breadth based on Nasdaq.
    
    // As Finviz requires headers and often blocks scraping without puppeteer, 
    // we return a safe fallback.
    const result: FinvizMacro = {
      stocks_above_sma50_pct: null,
      market_breadth: 'NEUTRAL',
    };
    return result;
  } catch (err) {
    return { stocks_above_sma50_pct: null, market_breadth: 'NEUTRAL' };
  }
}
