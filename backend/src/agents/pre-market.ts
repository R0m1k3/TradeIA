import { getEquityOHLCV, getYahooVIX } from '../data/yahoo';
import { getMacroData } from '../data/fred';
import { savePrep } from '../models/pre-market';
import { broadcast } from '../websocket';
import { NASDAQ_100, DAX_40, CAC_40 } from './discovery';

export interface PreMarketResult {
  ticker: string;
  setupSignal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning: string;
  closePrev: number;
  vixPrev: number | null;
}

function computeEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

async function analyzeTicker(ticker: string, vix: number | null): Promise<PreMarketResult | null> {
  try {
    const bars = await getEquityOHLCV(ticker, '1d');
    if (bars.length < 25) return null;

    const closes = bars.map((b) => b.close);
    const ema20 = computeEMA(closes.slice(-25), 20);
    if (!ema20) return null;

    const closePrev = closes[closes.length - 1];
    const distPct = ((closePrev - ema20) / ema20) * 100;

    let setupSignal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let confidence = 50;
    let reasoning = '';

    if (closePrev > ema20 && (vix === null || vix < 22)) {
      setupSignal = 'BUY';
      confidence = Math.min(95, Math.round(60 + Math.abs(distPct) * 3));
      reasoning = `Close ${closePrev.toFixed(2)} > EMA20 ${ema20.toFixed(2)} (+${distPct.toFixed(1)}%). Tendance haussière${vix !== null ? `, VIX ${vix.toFixed(1)} calme` : ''}.`;
    } else if (closePrev < ema20 && (vix === null || vix > 20)) {
      setupSignal = 'SELL';
      confidence = Math.min(95, Math.round(60 + Math.abs(distPct) * 3));
      reasoning = `Close ${closePrev.toFixed(2)} < EMA20 ${ema20.toFixed(2)} (${distPct.toFixed(1)}%). Tendance baissière${vix !== null ? `, VIX ${vix.toFixed(1)} élevé` : ''}.`;
    } else {
      setupSignal = 'HOLD';
      confidence = Math.max(30, Math.round(50 - Math.abs(distPct) * 2));
      reasoning = `Close ${closePrev.toFixed(2)} proche EMA20 ${ema20.toFixed(2)} (${distPct.toFixed(1)}%). Pas de direction claire.`;
    }

    return { ticker, setupSignal, confidence, reasoning, closePrev, vixPrev: vix };
  } catch {
    return null;
  }
}

export async function runPreMarketAgent(): Promise<PreMarketResult[]> {
  const date = new Date().toISOString().slice(0, 10);
  const watchlist = [...NASDAQ_100, ...DAX_40, ...CAC_40].slice(0, 60); // limit to 60 for speed

  const vix = await getYahooVIX();
  let macroSummary = '';
  try {
    const macro = await getMacroData();
    macroSummary = macro.summary;
  } catch {
    // ignore
  }

  console.log(`[PreMarket] Analyzing ${watchlist.length} tickers for ${date}`);

  const results: PreMarketResult[] = [];
  for (let i = 0; i < watchlist.length; i += 10) {
    const batch = watchlist.slice(i, i + 10);
    const batchResults = await Promise.all(batch.map((t) => analyzeTicker(t, vix)));
    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  // Save all results
  for (const r of results) {
    await savePrep({
      date,
      ticker: r.ticker,
      closePrev: r.closePrev,
      vixPrev: r.vixPrev,
      macroSummary: macroSummary || null,
      setupSignal: r.setupSignal,
      confidence: r.confidence,
      reasoning: r.reasoning,
    }).catch((err) => console.warn('[PreMarket] Save failed for', r.ticker, err));
  }

  // Broadcast top setups
  const topSetups = results.filter((r) => r.setupSignal !== 'HOLD').sort((a, b) => b.confidence - a.confidence).slice(0, 10);
  broadcast('PRE_MARKET_UPDATE', {
    date,
    count: results.length,
    top_setups: topSetups.map((r) => ({
      ticker: r.ticker,
      signal: r.setupSignal,
      confidence: r.confidence,
      reasoning: r.reasoning,
    })),
  });

  console.log(`[PreMarket] Saved ${results.length} prep entries, top ${topSetups.length} setups broadcast`);
  return results;
}
